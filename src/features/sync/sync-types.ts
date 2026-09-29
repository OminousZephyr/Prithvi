import type { SyncStatus } from '@/domain/models';

/** Canonical local entity names accepted by the version-1 remote contract. */
export const SYNCABLE_TYPES = new Set(['farm', 'field', 'crop', 'crop-observation', 'scouting-evidence', 'scouting-zone', 'scouting-task', 'advisory', 'alert', 'flight-session']);
export type SyncOperation = 'create' | 'update' | 'delete';
export interface SyncQueueItem { id: string; localUserId: string; remoteUserId?: string; entityType: string; entityId: string; operation: SyncOperation; payload: Record<string, unknown>; queuedAt: string; attempts: number; status: 'pending' | 'error'; error?: string }
export interface CloudRecord { id?: string; ownerId: string; localUserId: string; localId: string; recordType: string; payload: Record<string, unknown>; updatedAt: string; deletedAt?: string }
export interface SyncSnapshot { status: 'offline' | 'idle' | 'syncing' | 'synced' | 'error' | 'auth_required'; pendingCount: number; lastSyncedAt?: string; message?: string }
export interface SyncProvider { getSnapshot(): SyncSnapshot; syncNow(): Promise<SyncSnapshot>; retry(): Promise<SyncSnapshot> }
/** Reserved contract for a later, separately enabled image-upload stage. */
export interface ImageSyncProvider { uploadLocalImage(input: { localReference: string; ownerId: string; observationId: string }): Promise<{ remoteReference: string }> }
export interface SyncableRecord extends Record<string, unknown> { id: string; updatedAt?: string; syncStatus?: SyncStatus; lastSyncedAt?: string; remoteId?: string; deletedAt?: string }
