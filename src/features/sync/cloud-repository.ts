import type { SupabaseClient } from '@supabase/supabase-js';
import type { CloudRecord } from './sync-types.ts';

export interface CloudRepository {
  listOwned(ownerId: string): Promise<CloudRecord[]>;
  getOwned(ownerId: string, recordType: string, localId: string): Promise<CloudRecord | undefined>;
  upsertOwned(record: CloudRecord): Promise<{ remoteId: string }>;
}

/** Supabase rows are always scoped to the signed-in auth user; RLS independently enforces the same boundary. */
export class SupabaseCloudRepository implements CloudRepository {
  private readonly client: SupabaseClient;
  constructor(client: SupabaseClient) { this.client = client; }
  async listOwned(ownerId: string) {
    const { data, error } = await this.client.from('prithvi_sync_records').select('*').eq('owner_id', ownerId).order('updated_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(mapRow);
  }
  async getOwned(ownerId: string, recordType: string, localId: string) {
    const { data, error } = await this.client.from('prithvi_sync_records').select('*').eq('owner_id', ownerId).eq('record_type', recordType).eq('local_id', localId).maybeSingle();
    if (error) throw error;
    return data ? mapRow(data) : undefined;
  }
  async upsertOwned(record: CloudRecord) {
    const body = { owner_id: record.ownerId, local_user_id: record.localUserId, local_id: record.localId, record_type: record.recordType, payload: record.payload, updated_at: record.updatedAt, deleted_at: record.deletedAt ?? null };
    const { data, error } = await this.client.from('prithvi_sync_records').upsert(body, { onConflict: 'owner_id,record_type,local_id' }).select('id').single();
    if (error) throw error;
    return { remoteId: data.id as string };
  }
}

function mapRow(row: Record<string, unknown>): CloudRecord {
  return { id: String(row.id), ownerId: String(row.owner_id), localUserId: String(row.local_user_id), localId: String(row.local_id), recordType: String(row.record_type), payload: (row.payload ?? {}) as Record<string, unknown>, updatedAt: String(row.updated_at), deletedAt: typeof row.deleted_at === 'string' ? row.deleted_at : undefined };
}

