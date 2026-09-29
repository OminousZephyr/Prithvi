export interface StoredEntity { id: string; createdAt?: string; updatedAt?: string; syncState?: 'local' | 'pending' | 'synced' | 'failed' }
