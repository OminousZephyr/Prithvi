import type { StoredEntity } from '@/data/storage/local-store-contracts';
import type { SyncRecord } from '@/domain/models';
import { createSyncAwareStore } from '@/features/sync/sync-aware-store';

const prefix = 'prithvi:';

const baseLocalStore = {
  async list<T>(type: string): Promise<T[]> {
    if (typeof localStorage === 'undefined') return [];
    const values: T[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${prefix}${type}:`)) {
        const value = localStorage.getItem(key);
        if (value) values.push(JSON.parse(value) as T);
      }
    }
    return values;
  },
  async get<T>(type: string, id: string): Promise<T | undefined> {
    if (typeof localStorage === 'undefined') return undefined;
    const value = localStorage.getItem(`${prefix}${type}:${id}`);
    return value ? (JSON.parse(value) as T) : undefined;
  },
  async save<T extends StoredEntity>(type: string, value: T): Promise<T> {
    const supplied = value as StoredEntity & { syncStatus?: string };
    const updatedAt = supplied.updatedAt && Number.isFinite(Date.parse(supplied.updatedAt)) ? supplied.updatedAt : new Date().toISOString();
    const entity = { ...value, updatedAt, syncState: value.syncState ?? 'pending' };
    if (typeof localStorage !== 'undefined') localStorage.setItem(`${prefix}${type}:${value.id}`, JSON.stringify(entity));
    return entity;
  },
  async remove(type: string, id: string) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(`${prefix}${type}:${id}`);
  },
  async syncCounts() {
    const values = await this.list<{ syncState?: string }>('farm');
    const fields = await this.list<{ syncState?: string }>('field');
    const all = [...values, ...fields];
    return { pending: all.filter((entry) => entry.syncState === 'pending').length, failed: all.filter((entry) => entry.syncState === 'failed').length };
  },
  async listSyncRecords(): Promise<SyncRecord[]> {
    if (typeof localStorage === 'undefined') return [];
    const records: SyncRecord[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const value = localStorage.getItem(key);
      if (!value) continue;
      const entity = JSON.parse(value) as StoredEntity;
      const [, entityType] = key.split(':');
      records.push({ id: `${entityType}:${entity.id}`, entityType, entityId: entity.id, state: entity.syncState ?? 'local', updatedAt: entity.updatedAt ?? entity.createdAt ?? new Date(0).toISOString() });
    }
    return records;
  },
};
export const localStore = createSyncAwareStore(baseLocalStore);
