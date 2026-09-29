import type { SyncQueueItem, SyncOperation } from './sync-types.ts';

export interface SyncQueueStore { list<T>(type: string): Promise<T[]>; get<T>(type: string, id: string): Promise<T | undefined>; save<T extends { id: string }>(type: string, value: T): Promise<T>; remove?(type: string, id: string): Promise<void> }

export class SyncQueue {
  private readonly store: SyncQueueStore;
  constructor(store: SyncQueueStore) { this.store = store; }
  async enqueue(input: { localUserId: string; entityType: string; entityId: string; operation: SyncOperation; payload: Record<string, unknown>; remoteUserId?: string }) {
    const id = `${input.entityType}:${input.entityId}`;
    const existing = await this.store.get<SyncQueueItem>('sync-queue', id);
    let operation = input.operation;
    if (existing?.operation === 'delete') operation = 'delete';
    else if (existing?.operation === 'create' && input.operation === 'update') operation = 'create';
    const item: SyncQueueItem = { id, localUserId: input.localUserId, remoteUserId: input.remoteUserId, entityType: input.entityType, entityId: input.entityId, operation, payload: input.payload, queuedAt: new Date().toISOString(), attempts: existing?.attempts ?? 0, status: 'pending' };
    return this.store.save('sync-queue', item);
  }
  listPending() { return this.store.list<SyncQueueItem>('sync-queue'); }
  async complete(id: string) { const item = await this.store.get<SyncQueueItem>('sync-queue', id); if (item) await this.store.remove?.('sync-queue', id); }
  async fail(id: string, error: string) { const item = await this.store.get<SyncQueueItem>('sync-queue', id); if (item) return this.store.save('sync-queue', { ...item, attempts: item.attempts + 1, status: 'error', error }); }
  async retryAll() { const items = await this.listPending(); for (const item of items) if (item.status === 'error') await this.store.save('sync-queue', { ...item, status: 'pending', error: undefined }); }
}
