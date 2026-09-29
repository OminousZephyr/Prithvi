import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBoundaryArea, isValidFieldBoundary, normalizeFieldGeometry } from '../../src/features/scouting/field-geometry.ts';
import { toMapObservation, toMapObservations } from '../../src/features/scouting/observation-markers.ts';
import { ScoutingRepository, summarizeFieldHealth } from '../../src/features/scouting/scouting-repository.ts';
import { DroneRepository } from '../../src/features/drone/drone-repository.ts';
import { parseTelemetryJson } from '../../src/features/drone/telemetry-parser.ts';

const square = [{ latitude: 12, longitude: 76 }, { latitude: 12, longitude: 76.001 }, { latitude: 12.001, longitude: 76.001 }, { latitude: 12.001, longitude: 76 }];
const now = new Date().toISOString();
const field = { id: 'field-1', farmId: 'farm-1', name: 'North field', boundary: square, sensorNodeIds: [], observationIds: [], healthStatus: 'unassessed', createdAt: now, syncState: 'local' };
function observation(id, overrides = {}) { return { id, fieldId: 'field-1', farmId: 'farm-1', kind: 'crop_health', title: 'Possible crop-health issue', observedAt: now, timestamp: now, latitude: 12.0001, longitude: 76.0001, source: 'esp32_cam_rgb', confidence: 0.83, evidence: [], verificationStatus: 'requires_verification', syncState: 'local', crop: 'Tomato', condition: 'Early blight', scanStatus: 'possible_issue', imageQuality: 'acceptable', ...overrides }; }
function storeWith(initial = {}) { const rows = new Map(Object.entries(initial).flatMap(([type, values]) => values.map((value) => [`${type}:${value.id}`, value]))); return { rows, async list(type) { return [...rows.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async get(type, id) { return rows.get(`${type}:${id}`); }, async save(type, value) { rows.set(`${type}:${value.id}`, value); return value; } }; }

test('validates field boundaries, rejects invalid coordinates, and derives center/acre area only from a real boundary', () => {
  assert.equal(isValidFieldBoundary(square), true); assert.ok(calculateBoundaryArea(square).value > 0);
  assert.equal(isValidFieldBoundary([{ latitude: 91, longitude: 1 }, ...square.slice(1)]), false);
  assert.equal(isValidFieldBoundary([{ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 }]), false);
  const normalized = normalizeFieldGeometry(field); assert.ok(Math.abs(normalized.center.latitude - 12.0005) < 1e-9); assert.equal(normalized.area.unit, 'acre');
  assert.equal(normalizeFieldGeometry({ ...field, boundary: undefined }).area, undefined);
});

test('observation markers require real valid GPS and preserve farmer-facing categories', () => {
  assert.equal(toMapObservation(observation('without-location', { latitude: undefined, longitude: undefined })), undefined);
  assert.equal(toMapObservation(observation('invalid', { latitude: 91 })), undefined);
  assert.equal(toMapObservation(observation('unavailable', { scanStatus: 'unavailable' })), undefined);
  assert.equal(toMapObservation(observation('simulated', { source: 'simulated' })), undefined);
  assert.equal(toMapObservation(observation('low', { scanStatus: 'uncertain', confidence: 0.4 })).category, 'needs_verification');
  assert.equal(toMapObservation(observation('healthy', { scanStatus: 'healthy_looking', verificationStatus: 'verified' })).category, 'healthy_looking');
  assert.equal(toMapObservations([observation('a'), observation('b', { latitude: null })], 'field-1').length, 1);
});

test('groups only nearby same-problem confident observations into conservative inspection zones', async () => {
  const store = storeWith({ field: [field], 'crop-observation': [
    observation('a'), observation('b', { latitude: 12.0002, longitude: 76.0002 }),
    observation('uncertain', { latitude: 12.00015, longitude: 76.00015, scanStatus: 'uncertain', confidence: 0.95 }),
    observation('low', { latitude: 12.00016, longitude: 76.00016, confidence: 0.4 }),
    observation('no-gps', { latitude: undefined, longitude: undefined }),
    observation('different', { latitude: 12.00014, longitude: 76.00014, condition: 'Leaf spot' }),
  ] });
  const repo = new ScoutingRepository(store);
  const zones = await repo.getZones('field-1');
  assert.equal(zones.length, 1); assert.deepEqual(zones[0].observationIds, ['a', 'b']); assert.equal(zones[0].severity, 'inspection_suggested'); assert.equal(zones[0].status, 'inspection_suggested');
  assert.equal(summarizeFieldHealth(await store.list('crop-observation'), zones).observationCount, 6);
  const summary = summarizeFieldHealth([observation('healthy', { scanStatus: 'healthy_looking' }), observation('unavailable', { scanStatus: 'unavailable' }), observation('simulated', { source: 'simulated' })], []);
  assert.deepEqual(summary, { observationCount: 1, possibleIssueCount: 0, healthyLookingCount: 1, inspectionAreaCount: 0, pendingRescanCount: 0 });
});

test('targeted rescan creates a local state only and remains idempotent; no flight commands exist in repository API', async () => {
  const store = storeWith(); const repo = new ScoutingRepository(store);
  const zone = { id: 'zone-a', fieldId: 'field-1', center: { latitude: 12, longitude: 76 }, observationIds: ['a', 'b'], status: 'inspection_suggested', severity: 'inspection_suggested', createdAt: now, updatedAt: now };
  await store.save('scouting-zone', zone);
  const task = await repo.requestTargetedRescan('field-1', 'zone-a', ['a', 'b']);
  assert.equal(task.status, 'rescan_requested'); assert.equal(task.syncState, 'local');
  assert.equal((await repo.requestTargetedRescan('field-1', 'zone-a', ['a', 'b'])).id, task.id);
  assert.equal((await store.get('scouting-zone', 'zone-a')).status, 'rescan_requested');
  assert.equal(typeof repo.takeoff, 'undefined'); assert.equal(typeof repo.uploadMission, 'undefined');
});

test('map data comes only from local observations and persisted valid drone track points; stale telemetry is hidden', async () => {
  const flightDb = storeWith({ field: [field], 'crop-observation': [observation('mapped', { flightSessionId: 'flight-1' })] });
  const droneRepo = new DroneRepository(flightDb);
  await flightDb.save('flight-session', { id: 'flight-1', droneId: 'drone-1', startedAt: now, endedAt: null, status: 'active', telemetryCount: 1, observationCount: 1, syncState: 'local' });
  await flightDb.save('drone-track-point', { id: 'point-1', flightSessionId: 'flight-1', timestamp: now, latitude: 12.1, longitude: 76.1, altitudeM: 12, headingDegrees: 30, syncState: 'local' });
  await droneRepo.recordTelemetry(parseTelemetryJson({ drone_id: 'drone-1', connection: 'connected', latitude: 12.2, longitude: 76.2, gps_fix: 3, armed: true }, now));
  const repo = new ScoutingRepository(flightDb, droneRepo); const map = await repo.getMapData('field-1');
  assert.equal(map.observations.length, 1); assert.equal(map.track.length, 2); assert.equal(map.dronePosition.latitude, 12.2);
  const staleStore = storeWith({ field: [field], 'crop-observation': [] });
  const staleRepo = new DroneRepository(staleStore); await staleStore.save('drone-telemetry', parseTelemetryJson({ drone_id: 'drone-1', connection: 'connected', latitude: 12.2, longitude: 76.2, gps_fix: 3 }, '2000-01-01T00:00:00.000Z'));
  assert.equal((await new ScoutingRepository(staleStore, staleRepo).getMapData('field-1')).dronePosition, undefined);
  await staleRepo.recordTelemetry(parseTelemetryJson({ drone_id: 'drone-1', connection: 'connected', latitude: 12.2, longitude: 76.2, gps_fix: 0 }, new Date().toISOString()));
  assert.equal((await new ScoutingRepository(staleStore, staleRepo).getMapData('field-1')).dronePosition, undefined);
});

test('offline field, marker, zone and task persistence is local and does not call a remote service', async () => {
  const store = storeWith({ field: [field], 'crop-observation': [observation('a'), observation('b', { latitude: 12.0002 })] });
  const repo = new ScoutingRepository(store); const zone = (await repo.getZones('field-1'))[0];
  const task = await repo.requestTargetedRescan('field-1', zone.id, zone.observationIds);
  assert.ok(await store.get('scouting-task', task.id)); assert.equal((await repo.getMapData('field-1')).observations.length, 2);
});
