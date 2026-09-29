import * as SQLite from 'expo-sqlite';

import { createSqliteEntityStore } from '@/data/storage/sqlite-entity-store';
import { createSyncAwareStore } from '@/features/sync/sync-aware-store';

export type { StoredEntity } from '@/data/storage/local-store-contracts';

const sqliteStore = createSqliteEntityStore(async () => SQLite.openDatabaseAsync('prithvi.db'));
export const localStore = createSyncAwareStore(sqliteStore);
