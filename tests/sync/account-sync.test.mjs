import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountService, normalizeE164 } from '../../src/features/account/account-service.ts';
import { SyncQueue } from '../../src/features/sync/sync-queue.ts';
import { createSyncAwareStore } from '../../src/features/sync/sync-aware-store.ts';
import { SyncService, mergeSyncConflict } from '../../src/features/sync/sync-service.ts';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteEntityStore } from '../../src/data/storage/sqlite-entity-store.ts';
import { translate } from '../../src/localization/resources.ts';

function rawStore() {
  const entries = new Map();
  return { entries, async list(type) { return [...entries.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async get(type, id) { return entries.get(`${type}:${id}`); }, async save(type, value) { const saved = { ...value, updatedAt: value.syncStatus === 'synced' && value.updatedAt ? value.updatedAt : new Date().toISOString() }; entries.set(`${type}:${value.id}`, saved); return saved; }, async remove(type, id) { entries.delete(`${type}:${id}`); }, async syncCounts() { return { pending: 0, failed: 0 }; }, async listSyncRecords() { return []; } };
}
function authProvider() { let current; const calls = { otp: [], verified: [], signOut: 0 }; return { calls, get configured() { return true; }, async requestOtp(phone) { calls.otp.push(phone); }, async verifyOtp(phone, otp) { calls.verified.push({ phone, otp }); current = { userId: 'remote-user-1', phone }; return current; }, async signOut() { calls.signOut += 1; current = undefined; }, async restoreSession() { return current; } }; }
class FakeCloud {
  records = new Map(); owners = []; fail = false;
  async getOwned(owner, type, id) { this.owners.push(owner); if (this.fail) throw new Error('offline'); return this.records.get(`${owner}:${type}:${id}`); }
  async listOwned(owner) { this.owners.push(owner); if (this.fail) throw new Error('offline'); return [...this.records.values()].filter((row) => row.ownerId === owner); }
  async upsertOwned(row) { this.owners.push(row.ownerId); if (this.fail) throw new Error('offline'); const id = row.id ?? `remote-${this.records.size + 1}`; this.records.set(`${row.ownerId}:${row.recordType}:${row.localId}`, { ...row, id }); return { remoteId: id }; }
}
const farm = (id = 'farm-local-1', changes = {}) => ({ id, name: 'North Farm', fieldIds: [], createdAt: '2026-09-20T10:00:00.000Z', syncState: 'local', ...changes });
async function signedIn(store) { const provider = authProvider(); const account = new AccountService(store, provider); await account.requestOtp('+919876543210'); await account.verifyOtp('+919876543210', '123456'); return { account, provider }; }

test('startup is usable offline and creates a stable local identity without requiring auth', async () => {
  const store = createSyncAwareStore(rawStore()); const account = new AccountService(store); const initial = await account.restoreSession();
  assert.equal(initial.status, 'signed_out'); assert.equal(initial.configured, false); const offline = await account.continueOffline();
  assert.equal(offline.status, 'offline_user'); assert.equal((await account.snapshot()).localUserId, initial.localUserId);
});

test('OTP uses E.164, tracks request, maps remote identity, restores and signs out without deleting local records', async () => {
  assert.equal(normalizeE164(' +91 (98765) 43210 '), '+919876543210'); assert.throws(() => normalizeE164('9876543210'), /country code/i);
  const store = createSyncAwareStore(rawStore()); const provider = authProvider(); const account = new AccountService(store, provider); await store.save('farm', farm());
  assert.equal((await account.requestOtp('+919876543210')).status, 'otp_requested'); assert.deepEqual(provider.calls.otp, ['+919876543210']);
  const signed = await account.verifyOtp('+919876543210', '123456'); assert.equal(signed.status, 'signed_in'); assert.notEqual(signed.localUserId, signed.remoteUserId);
  assert.equal((await account.restoreSession()).status, 'signed_in'); const out = await account.signOut();
  assert.equal(out.status, 'offline_user'); assert.equal(out.localUserId, signed.localUserId); assert.equal((await store.list('farm')).length, 1);
});

test('expired auth session is surfaced without blocking offline use and account text exists in English and Hindi', async () => {
  const store = createSyncAwareStore(rawStore()); const account = new AccountService(store, authProvider());
  const linked = await account.verifyOtp('+919876543210', '123456');
  const expiredProvider = { ...authProvider(), async restoreSession() { return undefined; } };
  const restored = await new AccountService(store, expiredProvider).restoreSession();
  assert.equal(restored.status, 'session_expired'); assert.equal(restored.localUserId, linked.localUserId);
  await new AccountService(store).continueOffline();
  for (const key of ['welcomeTitle', 'continueOffline', 'accountTitle', 'accountPhone', 'accountRequestOtp', 'accountVerifyOtp', 'accountSyncNow', 'accountSignOut', 'accountLocalSafe']) {
    assert.ok(translate('en', key)); assert.ok(translate('hi', key));
  }
});

test('profile name is stored locally while signed out and synced to the authenticated user when available', async () => {
  const store = createSyncAwareStore(rawStore()); const provider = authProvider(); let remoteName;
  provider.updateProfile = async (name) => { remoteName = name; };
  const account = new AccountService(store, provider);
  await account.continueOffline(); const local = await account.setDisplayName('Pranay');
  assert.equal(local.displayName, 'Pranay'); assert.equal(local.status, 'offline_user');
  await account.requestOtp('+919876543210'); const signed = await account.verifyOtp('+919876543210', '123456');
  assert.equal(signed.displayName, 'Pranay'); assert.equal(remoteName, 'Pranay'); assert.equal((await store.get('local-account', 'current')).profileSyncStatus, 'synced');
});

test('create/update/delete queue operations persist and coalesce across queue instances', async () => {
  const raw = rawStore(); const store = createSyncAwareStore(raw); await store.save('farm', farm()); await store.save('farm', farm('farm-local-1', { name: 'Updated' }));
  let rows = await store.queue.listPending(); assert.equal(rows.length, 1); assert.equal(rows[0].operation, 'create'); assert.equal(rows[0].payload.name, 'Updated');
  const queueAfterRestart = new SyncQueue(raw); assert.equal((await queueAfterRestart.listPending()).length, 1);
  await store.remove('farm', 'farm-local-1'); rows = await queueAfterRestart.listPending(); assert.equal(rows[0].operation, 'delete');
  assert.equal((await store.list('farm')).length, 0); assert.equal((await raw.get('farm', 'farm-local-1')).syncStatus, 'pending_delete');
  const secondRaw = rawStore(); const secondStore = createSyncAwareStore(secondRaw);
  await secondStore.saveSyncResult('farm', { ...farm('existing'), remoteId: 'remote-1', syncStatus: 'synced' });
  await secondStore.save('farm', farm('existing', { name: 'Edited locally' }));
  assert.equal((await secondStore.queue.listPending())[0].operation, 'update');
});

test('sync queue and entity status survive reconstruction of the SQLite-backed app store', async () => {
  const database = new DatabaseSync(':memory:');
  const open = async () => ({ async execAsync(sql) { database.exec(sql); }, async getAllAsync(sql, ...params) { return database.prepare(sql).all(...params); }, async getFirstAsync(sql, ...params) { return database.prepare(sql).get(...params) ?? null; }, async runAsync(sql, ...params) { return database.prepare(sql).run(...params); } });
  const first = createSyncAwareStore(createSqliteEntityStore(open));
  await first.save('farm', farm('durable-farm'));
  const localUserId = await first.ensureLocalUserId();
  const second = createSyncAwareStore(createSqliteEntityStore(open));
  const restored = await second.queue.listPending();
  assert.equal(restored.length, 1); assert.equal(restored[0].entityId, 'durable-farm'); assert.equal(restored[0].localUserId, localUserId);
  assert.equal((await second.get('farm', 'durable-farm')).syncStatus, 'pending_upload');
  database.close();
});

test('only approved records queue; observation image references remain local-only', async () => {
  const store = createSyncAwareStore(rawStore()); await store.save('sensor-reading', { id: 'reading', value: 23 }); await store.save('drone-telemetry', { id: 'telemetry' });
  await store.save('crop-observation', { id: 'obs', imageReference: 'file:///leaf.jpg', rawLabel: 'Tomato___healthy', confidence: .9, timestamp: '2026-09-20T10:00:00.000Z' });
  const queue = await store.queue.listPending(); assert.equal(queue.length, 1); assert.equal(queue[0].entityType, 'crop-observation'); assert.equal((await store.get('crop-observation', 'obs')).imageSyncStatus, 'local_only');
});

test('the remote contract includes standalone Crop and all requested syncable record kinds', async () => {
  const store = createSyncAwareStore(rawStore());
  const types = ['farm', 'field', 'crop', 'crop-observation', 'scouting-evidence', 'scouting-zone', 'scouting-task', 'advisory', 'alert', 'flight-session'];
  for (const type of types) await store.save(type, { id: `${type}-1`, updatedAt: '2026-09-20T10:00:00.000Z' });
  assert.deepEqual((await store.queue.listPending()).map((item) => item.entityType).sort(), [...types].sort());
});

test('local_only entity status remains local and is not added to the upload queue', async () => {
  const store = createSyncAwareStore(rawStore());
  await store.save('farm', { ...farm('local-farm'), syncStatus: 'local_only' });
  assert.equal((await store.get('farm', 'local-farm')).syncStatus, 'local_only');
  assert.equal((await store.queue.listPending()).length, 0);
});

test('queue failure and retry persist attempt count', async () => {
  const queue = new SyncQueue(rawStore()); await queue.enqueue({ localUserId: 'local-x', entityType: 'farm', entityId: 'f', operation: 'create', payload: { id: 'f' } });
  await queue.fail('farm:f', 'offline'); assert.equal((await queue.listPending())[0].attempts, 1); await queue.retryAll(); assert.equal((await queue.listPending())[0].status, 'pending');
});

test('sync uploads under authenticated owner, stores remote mapping, and never uploads photo bytes', async () => {
  const store = createSyncAwareStore(rawStore()); const { account } = await signedIn(store); await store.save('farm', farm());
  await store.save('crop-observation', { id: 'obs', crop: 'Tomato', condition: 'Early blight', rawLabel: 'Tomato___Early_blight', confidence: .84, modelVersion: 'mnet-v1', timestamp: '2026-09-20T10:00:00.000Z', imageReference: 'file:///leaf.jpg', verificationStatus: 'requires_verification' });
  const cloud = new FakeCloud(); const sync = new SyncService(store, store.queue, account, cloud); const result = await sync.syncNow();
  assert.equal(result.status, 'synced'); assert.equal(result.pendingCount, 0); assert.equal((await store.get('farm', 'farm-local-1')).syncStatus, 'synced');
  assert.ok((await store.get('farm', 'farm-local-1')).remoteId); assert.equal((await store.get('crop-observation', 'obs')).imageSyncStatus, 'local_only');
  assert.equal((await store.get('crop-observation', 'obs')).imageReference, 'file:///leaf.jpg');
  const uploadedObservation = [...cloud.records.values()].find((row) => row.recordType === 'crop-observation');
  assert.equal(uploadedObservation.payload.imageReference, undefined); assert.ok(cloud.owners.every((owner) => owner === 'remote-user-1'));
});

test('sync downloads only the authenticated owner records and leaves image references local-only', async () => {
  const store = createSyncAwareStore(rawStore()); const { account } = await signedIn(store); const cloud = new FakeCloud();
  await cloud.upsertOwned({ ownerId: 'remote-user-1', localUserId: 'source-install', localId: 'remote-observation', recordType: 'crop-observation', updatedAt: '2026-09-22T10:00:00Z', payload: { crop: 'Tomato', rawModelLabel: 'Tomato___healthy', confidence: .91, updatedAt: '2026-09-22T10:00:00Z', imageSyncStatus: 'local_only' } });
  await cloud.upsertOwned({ ownerId: 'someone-else', localUserId: 'other-install', localId: 'private', recordType: 'farm', updatedAt: '2026-09-22T10:00:00Z', payload: { name: 'Private' } });
  const result = await new SyncService(store, store.queue, account, cloud).syncNow();
  const downloaded = await store.get('crop-observation', 'remote-observation');
  assert.equal(result.status, 'synced'); assert.equal(downloaded.rawModelLabel, 'Tomato___healthy'); assert.equal(downloaded.imageReference, undefined);
  assert.equal(downloaded.imageSyncStatus, 'local_only'); assert.ok(downloaded.remoteId); assert.equal(await store.get('farm', 'private'), undefined);
});

test('sync failure retains SQLite data and durable retryable operation with safe status', async () => {
  const store = createSyncAwareStore(rawStore()); const { account } = await signedIn(store); await store.save('farm', farm()); const cloud = new FakeCloud(); cloud.fail = true;
  const result = await new SyncService(store, store.queue, account, cloud).syncNow(); assert.equal(result.status, 'error'); assert.match(result.message, /local data is safe/i);
  assert.equal((await store.list('farm')).length, 1); assert.equal((await store.queue.listPending())[0].status, 'error'); assert.equal((await store.raw.get('farm', 'farm-local-1')).syncStatus, 'error');
});

test('retry after cloud recovery uploads the persisted operation and clears its error', async () => {
  const store = createSyncAwareStore(rawStore()); const { account } = await signedIn(store); await store.save('farm', farm());
  const cloud = new FakeCloud(); cloud.fail = true;
  const service = new SyncService(store, store.queue, account, cloud);
  assert.equal((await service.syncNow()).status, 'error');
  cloud.fail = false;
  const result = await service.retry();
  assert.equal(result.status, 'synced'); assert.equal(result.pendingCount, 0);
  assert.equal((await store.get('farm', 'farm-local-1')).syncStatus, 'synced');
});

test('signed-out sync makes no cloud calls and leaves local queue intact', async () => {
  const store = createSyncAwareStore(rawStore()); const account = new AccountService(store); await store.save('farm', farm()); const cloud = new FakeCloud();
  assert.equal((await new SyncService(store, store.queue, account, cloud).syncNow()).status, 'auth_required'); assert.equal(cloud.owners.length, 0);
  assert.equal((await store.list('farm')).length, 1); assert.equal((await store.queue.listPending()).length, 1);
});

test('latest valid timestamp wins conflicts while verification and model result history are preserved', () => {
  const local = { id: 'o', updatedAt: '2026-09-21T10:00:00Z', verificationStatus: 'verified', verificationHistory: [{ state: 'verified', changedAt: '2026-09-21T10:00:00Z', by: 'farmer' }], rawLabel: 'Tomato___Early_blight', rawModelLabel: 'Tomato___Early_blight', confidence: .84, modelVersion: 'mnet-v1', timestamp: '2026-09-20T10:00:00Z' };
  const remote = { updatedAt: '2026-09-22T10:00:00Z', verificationStatus: 'dismissed', verificationHistory: [{ state: 'dismissed', changedAt: '2026-09-22T10:00:00Z', by: 'farmer' }], rawLabel: 'Tomato___healthy', confidence: .99, modelVersion: 'mnet-v2', timestamp: '2026-09-22T10:00:00Z' };
  const merged = mergeSyncConflict('crop-observation', local, remote); assert.equal(merged.verificationStatus, 'dismissed');
  assert.equal(merged.rawLabel, 'Tomato___Early_blight'); assert.equal(merged.confidence, .84); assert.equal(merged.verificationHistory.length, 2); assert.equal(merged.modelResultHistory.length, 2);
  assert.equal(mergeSyncConflict('farm', { id: 'f', updatedAt: '2026-09-21T10:00:00Z', name: 'local' }, { updatedAt: '2026-09-22T10:00:00Z', name: 'remote' }).name, 'remote');
});

test('an actual conflict is marked while resolving and keeps its original timestamp and local photo reference', async () => {
  const store = createSyncAwareStore(rawStore()); const { account } = await signedIn(store);
  await store.save('crop-observation', { id: 'obs-conflict', rawModelLabel: 'Tomato___Early_blight', confidence: .84, verificationStatus: 'requires_verification', verificationHistory: [], modelVersion: 'm1', imageReference: 'file:///local.jpg', timestamp: '2026-09-20T10:00:00.000Z' });
  const local = await store.raw.get('crop-observation', 'obs-conflict');
  const cloud = new FakeCloud();
  await cloud.upsertOwned({ ownerId: 'remote-user-1', localUserId: 'local-user', localId: 'obs-conflict', recordType: 'crop-observation', updatedAt: '2035-01-01T00:00:00.000Z', payload: { updatedAt: '2035-01-01T00:00:00.000Z', rawModelLabel: 'Tomato___healthy', confidence: .99, verificationStatus: 'verified', verificationHistory: [{ state: 'verified', changedAt: '2035-01-01T00:00:00.000Z', by: 'farmer' }] } });
  const result = await new SyncService(store, store.queue, account, cloud).syncNow();
  const saved = await store.get('crop-observation', 'obs-conflict');
  assert.equal(result.status, 'synced'); assert.equal(saved.syncStatus, 'synced');
  assert.equal(saved.rawModelLabel, 'Tomato___Early_blight'); assert.equal(saved.confidence, .84);
  assert.equal(saved.verificationStatus, 'verified'); assert.equal(saved.verificationHistory.length, 1);
  assert.equal(saved.imageReference, 'file:///local.jpg'); assert.equal(saved.updatedAt, '2035-01-01T00:00:00.000Z'); assert.notEqual(local.updatedAt, saved.updatedAt);
  const remote = [...cloud.records.values()].find((row) => row.localId === 'obs-conflict');
  assert.equal(remote.payload.imageReference, undefined); assert.equal(remote.payload.rawModelLabel, 'Tomato___Early_blight');
});

test('sync writes an owner-scoped tombstone and does not requeue it on the next pull', async () => {
  const store = createSyncAwareStore(rawStore()); const { account } = await signedIn(store); await store.save('farm', farm());
  const cloud = new FakeCloud(); const service = new SyncService(store, store.queue, account, cloud);
  await service.syncNow(); await store.remove('farm', 'farm-local-1');
  assert.equal((await service.syncNow()).status, 'synced');
  assert.equal((await store.queue.listPending()).length, 0);
  const remote = [...cloud.records.values()].find((row) => row.recordType === 'farm');
  assert.ok(remote.deletedAt); assert.equal(await store.get('farm', 'farm-local-1'), undefined);
  await service.syncNow(); assert.equal((await store.queue.listPending()).length, 0);
});

test('remote sync is isolated to the authenticated owner and never imports another account records', async () => {
  const store = createSyncAwareStore(rawStore()); const { account } = await signedIn(store); const cloud = new FakeCloud();
  await cloud.upsertOwned({ ownerId: 'another-user', localUserId: 'other-local', localId: 'private-farm', recordType: 'farm', payload: { id: 'private-farm' }, updatedAt: new Date().toISOString() });
  cloud.owners.length = 0;
  await new SyncService(store, store.queue, account, cloud).syncNow(); assert.equal(await store.get('farm', 'private-farm'), undefined); assert.ok(cloud.owners.every((owner) => owner === 'remote-user-1'));
});
