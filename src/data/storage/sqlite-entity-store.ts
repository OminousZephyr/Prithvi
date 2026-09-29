import type { SyncRecord } from '@/domain/models';
import type { StoredEntity } from '@/data/storage/local-store-contracts';

export interface SqliteDatabaseLike {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: (string | number)[]): Promise<T | null>;
  runAsync(sql: string, ...params: (string | number)[]): Promise<unknown>;
}

/** Shared implementation used by Expo SQLite and exercised with SQLite's native test driver. */
export function createSqliteEntityStore(openDatabase: () => Promise<SqliteDatabaseLike>) {
  let databasePromise: Promise<SqliteDatabaseLike> | undefined;

  async function database() {
    databasePromise ??= openDatabase().then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS entities (
          type TEXT NOT NULL,
          id TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          sync_state TEXT NOT NULL DEFAULT 'local',
          PRIMARY KEY (type, id)
        );
        CREATE INDEX IF NOT EXISTS entities_by_type ON entities(type);
      `);
      return db;
    });
    return databasePromise;
  }

  return {
    async list<T>(type: string): Promise<T[]> {
      const db = await database();
      const rows = await db.getAllAsync<{ payload: string }>('SELECT payload FROM entities WHERE type = ? ORDER BY updated_at DESC', type);
      return rows.map((row) => JSON.parse(row.payload) as T);
    },
    async get<T>(type: string, id: string): Promise<T | undefined> {
      const db = await database();
      const row = await db.getFirstAsync<{ payload: string }>('SELECT payload FROM entities WHERE type = ? AND id = ?', type, id);
      return row ? JSON.parse(row.payload) as T : undefined;
    },
    async remove(type: string, id: string) {
      const db = await database();
      await db.runAsync('DELETE FROM entities WHERE type = ? AND id = ?', type, id);
    },
    async save<T extends StoredEntity>(type: string, value: T): Promise<T> {
      const db = await database();
      const supplied = value as StoredEntity & { syncStatus?: string };
      const updatedAt = supplied.updatedAt && Number.isFinite(Date.parse(supplied.updatedAt)) ? supplied.updatedAt : new Date().toISOString();
      const entity = { ...value, updatedAt, syncState: value.syncState ?? 'pending' };
      await db.runAsync('INSERT INTO entities (type, id, payload, updated_at, sync_state) VALUES (?, ?, ?, ?, ?) ON CONFLICT(type, id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, sync_state = excluded.sync_state', type, entity.id, JSON.stringify(entity), updatedAt, entity.syncState);
      return entity;
    },
    async syncCounts() {
      const db = await database();
      const rows = await db.getAllAsync<{ sync_state: string; count: number }>('SELECT sync_state, COUNT(*) as count FROM entities GROUP BY sync_state');
      return { pending: rows.find((row) => row.sync_state === 'pending')?.count ?? 0, failed: rows.find((row) => row.sync_state === 'failed')?.count ?? 0 };
    },
    async listSyncRecords(): Promise<SyncRecord[]> {
      const db = await database();
      const rows = await db.getAllAsync<{ type: string; id: string; updated_at: string; sync_state: SyncRecord['state'] }>('SELECT type, id, updated_at, sync_state FROM entities ORDER BY updated_at DESC');
      return rows.map((row) => ({ entityType: row.type, entityId: row.id, id: `${row.type}:${row.id}`, updatedAt: row.updated_at, state: row.sync_state }));
    },
  };
}
