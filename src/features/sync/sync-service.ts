import type { AccountService } from '@/features/account/account-service';
import type { SyncQueue } from './sync-queue.ts';
import type { CloudRepository } from './cloud-repository.ts';
import type { CloudRecord, SyncProvider, SyncQueueItem, SyncSnapshot, SyncableRecord } from './sync-types.ts';
import { SYNCABLE_TYPES } from './sync-types.ts';

export interface SyncLocalStore {
  list<T>(type: string): Promise<T[]>;
  get<T>(type: string, id: string): Promise<T | undefined>;
  save<T extends { id: string }>(type: string, value: T): Promise<T>;
  raw?: SyncLocalStore;
  saveSyncResult?<T extends { id: string }>(type: string, value: T): Promise<T>;
}

export class SyncService implements SyncProvider {
  private readonly store: SyncLocalStore;
  private readonly queue: SyncQueue;
  private readonly account: AccountService;
  private readonly cloud?: CloudRepository;
  private syncing = false;
  private state: SyncSnapshot = { status: 'idle', pendingCount: 0 };
  private readonly saveResult: <T extends { id: string }>(type: string, value: T) => Promise<T>;
  constructor(store: SyncLocalStore, queue: SyncQueue, account: AccountService, cloud?: CloudRepository) { this.store = store.raw ?? store; this.saveResult = store.saveSyncResult ?? store.save.bind(store); this.queue = queue; this.account = account; this.cloud = cloud; }
  getSnapshot() { return this.state; }

  async syncNow(): Promise<SyncSnapshot> {
    if (this.syncing) return this.state;
    const auth = await this.account.snapshot();
    if (auth.remoteUserId && auth.status === 'signed_in') await this.enqueueLegacyRecords(auth.localUserId);
    const queued = await this.queue.listPending();
    if (!auth.remoteUserId || auth.status !== 'signed_in') return this.setState({ status: this.cloud ? 'auth_required' : 'offline', pendingCount: queued.length, message: this.cloud ? 'Sign in to sync. Your local data is safe.' : 'Cloud sync is not configured. Your local data is safe.' });
    if (!this.cloud) return this.setState({ status: 'offline', pendingCount: queued.length, message: 'Cloud sync unavailable. Your local data is safe.' });
    this.syncing = true;
    this.setState({ status: 'syncing', pendingCount: queued.length });
    let failed = false;
    const syncedAt = new Date().toISOString();
    try {
      for (const item of queued) {
        try { await this.pushItem(item, auth.localUserId, auth.remoteUserId, syncedAt); }
        catch (error) {
          failed = true;
          const local = await this.store.get<SyncableRecord>(item.entityType, item.entityId);
          if (local) await this.saveResult(item.entityType, { ...local, syncState: 'failed', syncStatus: 'error' });
          await this.queue.fail(item.id, safeError(error));
        }
      }
      try { await this.pullOwned(auth.localUserId, auth.remoteUserId, syncedAt); }
      catch { failed = true; }
      const remaining = await this.queue.listPending();
      const result = this.setState({ status: failed ? 'error' : 'synced', pendingCount: remaining.length, lastSyncedAt: failed ? this.state.lastSyncedAt : syncedAt, message: failed ? 'Cloud sync unavailable. Your local data is safe.' : undefined });
      if (!failed) await this.store.save('sync-metadata', { id: 'current', lastSyncedAt: syncedAt, status: 'synced' });
      return result;
    } catch {
      const remaining = await this.queue.listPending();
      return this.setState({ status: 'error', pendingCount: remaining.length, message: 'Cloud sync unavailable. Your local data is safe.' });
    } finally { this.syncing = false; }
  }

  async retry() { await this.queue.retryAll(); return this.syncNow(); }

  private async enqueueLegacyRecords(localUserId: string) {
    for (const entityType of SYNCABLE_TYPES) {
      const records = await this.store.list<SyncableRecord>(entityType);
      for (const record of records) {
        if (record.syncStatus === 'synced' || record.syncStatus === 'pending_delete' || record.syncStatus === 'local_only') continue;
        await this.queue.enqueue({ localUserId, entityType, entityId: record.id, operation: record.remoteId ? 'update' : 'create', payload: record });
      }
    }
  }

  private async pushItem(item: SyncQueueItem, localUserId: string, ownerId: string, syncedAt: string) {
    if (!SYNCABLE_TYPES.has(item.entityType)) { await this.queue.complete(item.id); return; }
    const local = await this.store.get<SyncableRecord>(item.entityType, item.entityId) ?? item.payload as SyncableRecord;
    const remote = await this.cloud!.getOwned(ownerId, item.entityType, item.entityId);
    if (remote && recordsDiffer(item.entityType, local, remote.payload)) {
      await this.saveResult(item.entityType, { ...local, syncState: 'pending', syncStatus: 'conflict' });
    }
    const merged = remote ? mergeSyncConflict(item.entityType, local, remote.payload) : local;
    const payload = toCloudPayload(item.entityType, {
      ...merged,
      ...(item.operation === 'delete' ? { deletedAt: local.deletedAt ?? syncedAt } : {}),
    });
    const record: CloudRecord = { id: typeof local.remoteId === 'string' ? local.remoteId : remote?.id, ownerId, localUserId, localId: item.entityId, recordType: item.entityType, payload, updatedAt: validUpdatedAt(payload.updatedAt, syncedAt), deletedAt: item.operation === 'delete' ? String(payload.deletedAt ?? syncedAt) : undefined };
    const { remoteId } = await this.cloud!.upsertOwned(record);
    await this.saveResult(item.entityType, {
      ...merged,
      ...(item.entityType === 'crop-observation' && typeof local.imageReference === 'string' ? { imageReference: local.imageReference } : {}),
      id: item.entityId, remoteId, syncState: 'synced', syncStatus: 'synced', lastSyncedAt: syncedAt,
      ...(item.entityType === 'crop-observation' ? { imageSyncStatus: 'local_only' } : {}),
    });
    await this.queue.complete(item.id);
  }

  private async pullOwned(localUserId: string, ownerId: string, syncedAt: string) {
    const remoteRecords = await this.cloud!.listOwned(ownerId);
    for (const remote of remoteRecords) {
      if (!SYNCABLE_TYPES.has(remote.recordType)) continue;
      const local = await this.store.get<SyncableRecord>(remote.recordType, remote.localId);
      const remoteDeletedAt = remote.deletedAt ?? (typeof remote.payload.deletedAt === 'string' ? remote.payload.deletedAt : undefined);
      if (!local) {
        await this.saveResult(remote.recordType, { ...remote.payload, ...(remoteDeletedAt ? { deletedAt: remoteDeletedAt } : {}), id: remote.localId, remoteId: remote.id, syncState: 'synced', syncStatus: 'synced', lastSyncedAt: syncedAt, ...(remote.recordType === 'crop-observation' ? { imageSyncStatus: 'local_only' } : {}) });
        continue;
      }
      if (remoteDeletedAt) {
        await this.saveResult(remote.recordType, { ...local, deletedAt: remoteDeletedAt, updatedAt: remote.payload.updatedAt ?? remote.updatedAt, remoteId: remote.id, syncState: 'synced', syncStatus: 'synced', lastSyncedAt: syncedAt });
        continue;
      }
      if (local.deletedAt) {
        await this.queue.enqueue({ localUserId, entityType: remote.recordType, entityId: remote.localId, operation: 'delete', payload: local, remoteUserId: ownerId });
        continue;
      }
      const merged = mergeSyncConflict(remote.recordType, local, remote.payload);
      const localTime = validUpdatedAt(local.updatedAt, '');
      const remoteTime = validUpdatedAt(remote.payload.updatedAt, remote.updatedAt);
      if (localTime > remoteTime) {
        await this.saveResult(remote.recordType, { ...local, syncState: 'pending', syncStatus: 'conflict' });
        await this.queue.enqueue({ localUserId, entityType: remote.recordType, entityId: remote.localId, operation: 'update', payload: merged, remoteUserId: ownerId });
        continue;
      }
      await this.saveResult(remote.recordType, { ...merged, id: remote.localId, remoteId: remote.id, syncState: 'synced', syncStatus: 'synced', lastSyncedAt: syncedAt, ...(remote.recordType === 'crop-observation' ? { imageSyncStatus: 'local_only' } : {}) });
    }
  }

  private setState(snapshot: SyncSnapshot) { this.state = snapshot; return snapshot; }
}

export function mergeSyncConflict(entityType: string, local: SyncableRecord, remote: Record<string, unknown>): Record<string, unknown> {
  const localAt = validUpdatedAt(local.updatedAt, '');
  const remoteAt = validUpdatedAt(remote.updatedAt, '');
  const newest = remoteAt > localAt ? remote : local;
  if (entityType !== 'crop-observation') return { ...newest };
  const localHistory = Array.isArray(local.verificationHistory) ? local.verificationHistory : [];
  const remoteHistory = Array.isArray(remote.verificationHistory) ? remote.verificationHistory : [];
  const verificationHistory = uniqueObjects([...localHistory, ...remoteHistory]);
  const localResult = modelResultSnapshot(local);
  const remoteResult = modelResultSnapshot(remote);
  const modelResultHistory = uniqueObjects([...(Array.isArray(local.modelResultHistory) ? local.modelResultHistory : []), ...(Array.isArray(remote.modelResultHistory) ? remote.modelResultHistory : []), ...(localResult ? [localResult] : []), ...(remoteResult ? [remoteResult] : [])]);
  const stableModel = localResult ?? remoteResult;
  return {
    ...newest,
    verificationHistory,
    modelResultHistory,
    ...(typeof local.imageReference === 'string' ? { imageReference: local.imageReference } : {}),
    imageSyncStatus: 'local_only',
    ...(stableModel ? { rawLabel: stableModel.rawLabel, rawModelLabel: stableModel.rawLabel, confidence: stableModel.confidence, modelVersion: stableModel.modelVersion } : {}),
  };
}

export function toCloudPayload(entityType: string, value: Record<string, unknown>) {
  const payload = { ...value };
  if (entityType === 'crop-observation') {
    delete payload.imageReference;
    delete payload.imageBlob;
    payload.imageSyncStatus = 'local_only';
  }
  return payload;
}

function modelResultSnapshot(value: Record<string, unknown>) {
  const rawLabel = typeof value.rawModelLabel === 'string' ? value.rawModelLabel : typeof value.rawLabel === 'string' ? value.rawLabel : undefined;
  const confidence = typeof value.confidence === 'number' ? value.confidence : undefined;
  const modelVersion = typeof value.modelVersion === 'string' ? value.modelVersion : undefined;
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp : typeof value.observedAt === 'string' ? value.observedAt : typeof value.updatedAt === 'string' ? value.updatedAt : '';
  return rawLabel || confidence !== undefined || modelVersion ? { rawLabel, confidence, modelVersion, timestamp } : undefined;
}
function uniqueObjects(values: unknown[]) { const seen = new Set<string>(); return values.filter((value) => { const key = JSON.stringify(value); if (seen.has(key)) return false; seen.add(key); return true; }); }
function validUpdatedAt(value: unknown, fallback: string) { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback; }
function recordsDiffer(entityType: string, local: SyncableRecord, remote: Record<string, unknown>) {
  const clean = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([key]) => !['syncState', 'syncStatus', 'lastSyncedAt', 'remoteId', 'imageSyncStatus'].includes(key)));
  const localComparable = clean(entityType === 'crop-observation' ? { ...local, imageReference: undefined, imageBlob: undefined } : local);
  const remoteComparable = clean(entityType === 'crop-observation' ? { ...remote, imageReference: undefined, imageBlob: undefined } : remote);
  return stableJson(localComparable) !== stableJson(remoteComparable);
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function safeError(error: unknown) { return error instanceof Error ? error.message.slice(0, 300) : 'Sync failed'; }
