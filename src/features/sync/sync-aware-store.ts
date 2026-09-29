import type { SyncableRecord } from './sync-types.ts';
import type { SyncRecord } from '@/domain/models';
import { SYNCABLE_TYPES } from './sync-types.ts';
import { SyncQueue, type SyncQueueStore } from './sync-queue.ts';

export interface EntityStore extends SyncQueueStore { remove?(type: string, id: string): Promise<void>; syncCounts(): Promise<{ pending: number; failed: number }>; listSyncRecords(): Promise<SyncRecord[]> }

/** Adds durable queue records around the existing local source of truth. It never enqueues telemetry or image blobs. */
export function createSyncAwareStore(base: EntityStore) {
  const queueStore: SyncQueueStore = {
    list: (type) => base.list(type), get: (type, id) => base.get(type, id), save: (type, value) => base.save(type, value),
    remove: (type, id) => base.remove?.(type, id) ?? Promise.resolve(),
  };
  const queue = new SyncQueue(queueStore);
  const wrapped: EntityStore & { queue: SyncQueue; raw: EntityStore; saveSyncResult<T extends { id: string }>(type: string, value: T): Promise<T>; ensureLocalUserId(): Promise<string> } = {
    ...base,
    raw: base,
    queue,
    saveSyncResult<T extends { id: string }>(type: string, value: T) { return base.save(type, value); },
    async ensureLocalUserId() {
      const existing = await base.get<{ id: string; localUserId: string }>('local-account', 'current');
      if (existing) return existing.localUserId;
      const localUserId = createLocalId();
      await base.save('local-account', { id: 'current', localUserId, status: 'signed_out', updatedAt: new Date().toISOString() });
      return localUserId;
    },
    async list<T>(type: string) { return (await base.list<T>(type)).filter((item) => !(item as { deletedAt?: string }).deletedAt); },
    async get<T>(type: string, id: string) { const item = await base.get<T & { deletedAt?: string }>(type, id); return item?.deletedAt ? undefined : item; },
    async save<T extends { id: string }>(type: string, value: T): Promise<T> {
      if (!SYNCABLE_TYPES.has(type)) return base.save(type, value);
      const record = value as T & SyncableRecord;
      const existing = await base.get<SyncableRecord>(type, record.id);
      const updatedAt = new Date().toISOString();
      if (record.syncStatus === 'local_only') {
        const saved = await base.save(type, { ...record, updatedAt, syncStatus: 'local_only', syncState: 'local' as const });
        if (existing?.syncStatus === 'pending_upload' || existing?.syncStatus === 'error' || existing?.syncStatus === 'conflict') await queueStore.remove?.('sync-queue', `${type}:${record.id}`);
        return saved;
      }
      const next = { ...record, updatedAt, syncState: 'pending' as const, syncStatus: 'pending_upload' as const, ...(type === 'crop-observation' ? { imageSyncStatus: record.imageSyncStatus ?? 'local_only' } : {}) };
      const saved = await base.save(type, next);
      const localUserId = await wrapped.ensureLocalUserId();
      await queue.enqueue({ localUserId, entityType: type, entityId: record.id, operation: existing ? 'update' : 'create', payload: saved as Record<string, unknown> });
      return saved;
    },
    async remove(type: string, id: string) {
      if (!SYNCABLE_TYPES.has(type)) { await base.remove?.(type, id); return; }
      const record = await base.get<SyncableRecord>(type, id);
      if (!record) return;
      const deletedAt = new Date().toISOString();
      const tombstone = await base.save(type, { ...record, deletedAt, updatedAt: deletedAt, syncState: 'pending', syncStatus: 'pending_delete' });
      const localUserId = await wrapped.ensureLocalUserId();
      await queue.enqueue({ localUserId, entityType: type, entityId: id, operation: 'delete', payload: tombstone as Record<string, unknown> });
    },
  };
  return wrapped;
}

function createLocalId() { return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
