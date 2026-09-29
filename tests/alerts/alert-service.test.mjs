import assert from 'node:assert/strict';
import test from 'node:test';
import { AlertService, evaluateAlertCandidates, selectHomeAlert } from '../../src/features/alerts/alert-service.ts';
import { translate } from '../../src/localization/resources.ts';

const now = '2026-09-29T10:00:00.000Z';
const field = { id: 'field-a', farmId: 'farm-a', name: 'North field', boundary: [{ latitude: 12, longitude: 76 }, { latitude: 12, longitude: 76.001 }, { latitude: 12.001, longitude: 76.001 }, { latitude: 12.001, longitude: 76 }], sensorNodeIds: [], observationIds: [], healthStatus: 'unassessed', createdAt: now, syncState: 'local' };
const observation = (id = 'obs-a', extra = {}) => ({ id, fieldId: field.id, farmId: field.farmId, title: 'Possible crop-health issue', observedAt: now, timestamp: now, source: 'esp32_cam_rgb', scanStatus: 'possible_issue', verificationStatus: 'requires_verification', confidence: 0.82, provenance: ['on_device_ai'], syncState: 'local', ...extra });
const zone = (extra = {}) => ({ id: 'zone-a', fieldId: field.id, center: { latitude: 12.0002, longitude: 76.0002 }, observationIds: ['obs-a', 'obs-b'], status: 'inspection_suggested', severity: 'inspection_suggested', createdAt: now, updatedAt: now, ...extra });
function db(seed = {}) {
  const records = new Map(Object.entries(seed).flatMap(([type, rows]) => rows.map((row) => [`${type}:${row.id}`, row])));
  return { async list(type) { return [...records].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async get(type, id) { return records.get(`${type}:${id}`); }, async save(type, value) { const saved = { ...value }; records.set(`${type}:${value.id}`, saved); return saved; } };
}
const empty = (extra = {}) => ({ now, farms: [{ id: 'farm-a', fieldIds: [field.id] }], fields: [field], observations: [], zones: [], tasks: [], advisories: [], sensors: [], nodes: [], readings: [], sensorConfigured: false, sessions: [], telemetry: [], droneConfigured: false, ...extra });

test('qualifying repeated crop zone creates one inspection alert with a stable field/zone key', () => {
  const items = evaluateAlertCandidates(empty({ observations: [observation(), observation('obs-b')], zones: [zone()] }), { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 });
  const alert = items.find((item) => item.type === 'crop_inspection');
  assert.equal(alert.title, 'Inspection suggested'); assert.equal(alert.priority, 'medium'); assert.equal(alert.zoneId, 'zone-a');
  assert.equal(alert.dedupeKey, 'crop_inspection:field-a:zone-a'); assert.match(alert.message, /2 times/);
});

test('low-confidence, uncertain, verified, and simulated observations do not create crop alerts', () => {
  for (const item of [observation('low', { confidence: 0.2 }), observation('uncertain', { scanStatus: 'uncertain' }), observation('verified', { verificationStatus: 'verified' }), observation('demo', { source: 'simulated' })]) {
    assert.equal(evaluateAlertCandidates(empty({ observations: [item] }), { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 }).length, 0);
  }
});

test('stale configured sensor creates one low priority reminder; missing optional sensor does not', () => {
  const staleNode = { id: 'esp32-1', farmId: field.farmId, fieldId: field.id, name: 'Ground sensors', hardware: 'ESP32', status: 'stale', lastSeenAt: '2026-09-29T09:50:00.000Z', sensorIds: ['soil-1'] };
  const sensor = { id: 'soil-1', nodeId: staleNode.id, kind: 'soil_moisture', label: 'Soil', unit: 'ADC count' };
  const configured = empty({ sensorConfigured: true, nodes: [staleNode], sensors: [sensor] });
  const items = evaluateAlertCandidates(configured, { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 });
  assert.equal(items.length, 1); assert.equal(items[0].type, 'sensor'); assert.equal(items[0].priority, 'low');
  assert.equal(evaluateAlertCandidates({ ...configured, sensorConfigured: false }, { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 }).length, 0);
});

test('configured sensor with a sufficiently old last report gets a connection alert; never alert before threshold', () => {
  const context = empty({ sensorConfigured: true, sensorConnection: { status: 'disconnected', deviceId: 'esp32-1', lastReceivedAt: '2026-09-29T09:50:00.000Z' } });
  assert.equal(evaluateAlertCandidates(context, { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 })[0].dedupeKey, 'sensor:esp32-1:connection');
  assert.equal(evaluateAlertCandidates({ ...context, sensorConnection: { ...context.sensorConnection, lastReceivedAt: now } }, { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 }).length, 0);
  assert.equal(evaluateAlertCandidates({ ...context, sensorConnection: undefined }, { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 }).length, 0);
});

test('active inspection with real outside GPS raises geofence alert; no active flight and unknown GPS do not', () => {
  const session = { id: 'flight-1', droneId: 'drone-1', startedAt: now, endedAt: null, status: 'active', telemetryCount: 4, observationCount: 0, syncState: 'local' };
  const telemetry = { id: 'telemetry-1', droneId: session.droneId, receivedAt: now, timestamp: now, latitude: 13, longitude: 77, gpsFix: '3d', connectionState: 'connected' };
  const context = empty({ droneConfigured: true, sessions: [session], telemetry: [telemetry], tasks: [{ id: 'task', fieldId: field.id, status: 'rescan_in_progress' }] });
  assert.equal(evaluateAlertCandidates(context, { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 })[0].type, 'geofence');
  assert.equal(evaluateAlertCandidates({ ...context, sessions: [] }, { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 }).length, 0);
  assert.equal(evaluateAlertCandidates({ ...context, telemetry: [{ ...telemetry, gpsFix: 'no_fix', latitude: null, longitude: null }] }, { sensorStaleAfterMs: 300_000, expiryAfterMs: 1000 })[0].type, 'drone');
});

test('refresh persists once, state actions are distinct, and a new service instance reads history', async () => {
  const store = db({ field: [field], 'crop-observation': [observation()], 'scouting-zone': [zone()] }); const service = new AlertService(store, { now: () => new Date(now) });
  const [created] = await service.refresh(now); assert.equal(created.status, 'active');
  await service.refresh(now); assert.equal((await store.list('alert')).length, 1);
  const seen = await service.setStatus(created.id, 'acknowledged'); assert.equal(seen.status, 'acknowledged');
  const dismissed = await service.setStatus(created.id, 'dismissed'); assert.equal(dismissed.status, 'dismissed');
  assert.equal((await new AlertService(store).refresh(now))[0].status, 'dismissed');
});

test('resolved action remains distinct from acknowledgement and dismissal', async () => {
  const store = db({ field: [field], 'crop-observation': [observation()], 'scouting-zone': [zone()] }); const service = new AlertService(store, { now: () => new Date(now) });
  const [item] = await service.refresh(now); assert.equal((await service.setStatus(item.id, 'resolved')).status, 'resolved');
});

test('expiry is retained in local alert history', async () => {
  const store = db({ field: [field], 'crop-observation': [observation()], 'scouting-zone': [zone()] }); const service = new AlertService(store, { expiryAfterMs: 1000 });
  const [created] = await service.refresh(now); await service.refresh('2026-09-29T10:00:00.500Z'); const later = '2026-09-29T10:00:02.000Z';
  const items = await service.refresh(later); assert.equal(items.find((item) => item.id === created.id).status, 'expired');
});

test('Home selects at most one medium/high active or acknowledged alert', () => {
  const base = { id: 'x', type: 'sensor', priority: 'low', title: 'x', message: 'x', createdAt: now, updatedAt: now, status: 'active', dedupeKey: 'x', source: 'sensor', syncState: 'local' };
  assert.equal(selectHomeAlert([{ ...base, id: 'low' }]), undefined);
  assert.equal(selectHomeAlert([{ ...base, id: 'a', priority: 'medium' }, { ...base, id: 'b', priority: 'high' }]).id, 'b');
});

test('alert labels and actions are present in English and Hindi', () => {
  for (const key of ['alertsNeedsAttention', 'alertsMonitoring', 'alertsResolved', 'alertAcknowledge', 'alertDismissAction', 'alertResolveAction', 'alertCropInspection', 'alertSensor']) {
    assert.ok(translate('en', key)); assert.ok(translate('hi', key)); assert.notEqual(translate('en', key), translate('hi', key));
  }
});
