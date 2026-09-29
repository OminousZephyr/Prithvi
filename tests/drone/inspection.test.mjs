import assert from 'node:assert/strict';
import test from 'node:test';

import { AIRepository } from '../../src/features/ai/ai-repository.ts';
import { DroneInspectionCaptureService, InspectionCameraUnavailableError, InspectionResultInvalidError } from '../../src/features/drone/inspection-capture-service.ts';
import { DroneRepository } from '../../src/features/drone/drone-repository.ts';
import { createInspectionCaptureContext } from '../../src/features/drone/inspection-capture.ts';
import { parseTelemetryJson } from '../../src/features/drone/telemetry-parser.ts';
import { evaluateFieldGeofence } from '../../src/features/scouting/geofence.ts';
import { ScoutingRepository } from '../../src/features/scouting/scouting-repository.ts';
import { translate } from '../../src/localization/resources.ts';

const at = '2026-09-28T10:00:00.000Z';
const boundary = [{ latitude: 12, longitude: 76 }, { latitude: 12, longitude: 76.01 }, { latitude: 12.01, longitude: 76.01 }, { latitude: 12.01, longitude: 76 }];
const field = { id: 'field-1', farmId: 'farm-1', name: 'North field', boundary, sensorNodeIds: [], observationIds: [], healthStatus: 'unknown', createdAt: at, syncState: 'local' };
const telemetryContract = { drone_id: 'drone-1', latitude: 12.005, longitude: 76.005, altitude: 41, relative_altitude: 12, ground_speed: 5, heading: 127, battery_voltage: 11.7, battery_percent: 78, satellites: 11, armed: false, flight_mode: 'STABILIZE', gps_fix: 3, connection: 'connected' };
function memoryStore() {
  const entries = new Map();
  return { entries, async list(type) { return [...entries.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async get(type, id) { return entries.get(`${type}:${id}`); }, async save(type, value) { entries.set(`${type}:${value.id}`, value); return value; } };
}
function sampleResult(overrides = {}) { return { status: 'possible_issue', crop: 'Tomato', condition: 'Early blight', confidence: 0.84, observation: 'Possible crop-health issue', modelVersion: 'mnet-v1', rawLabel: 'Tomato___Early_blight', source: 'esp32_cam_rgb', imageQuality: { status: 'acceptable', reason: null }, timestamp: at, provider: 'on_device_ai', provenance: ['on_device_ai'], inferenceValidated: true, ...overrides }; }
function setup({ cameraConnected = true, result = sampleResult(), telemetry = parseTelemetryJson({ ...telemetryContract, timestamp: 99 }, at), imageQualityThrows = false } = {}) {
  const store = memoryStore(); const drone = new DroneRepository(store); const observations = new AIRepository(store);
  if (telemetry) store.entries.set(`drone-telemetry:${telemetry.id}`, telemetry);
  const session = { id: 'inspection:drone-1:1', droneId: 'drone-1', fieldId: field.id, sessionType: 'inspection', startedAt: at, endedAt: null, status: 'active', telemetryCount: 0, observationCount: 0, imageCount: 0, zoneCount: 0, syncState: 'local' };
  store.entries.set(`flight-session:${session.id}`, session);
  let captures = 0; let analyses = 0; let progress;
  const camera = { async checkStatus() { return { connected: cameraConnected }; }, async capture() { captures += 1; return { imageUri: 'file:///capture.jpg', imageBlob: new Blob(['jpeg'], { type: 'image/jpeg' }), capturedAt: at }; } };
  const ai = { async analyzeImage(uri, metadata) { analyses += 1; progress = metadata.onProgress; if (imageQualityThrows) throw new Error('Unexpected image-quality pipeline error'); return { ...result, timestamp: metadata.capturedAt }; } };
  let advisoryRefresh = 0; let alertRefresh = 0;
  const service = new DroneInspectionCaptureService(camera, ai, drone, observations, { refreshAdvisories: async () => { advisoryRefresh += 1; }, refreshAlerts: async () => { alertRefresh += 1; } });
  return { store, drone, observations, session, service, counts: () => ({ captures, analyses, advisoryRefresh, alertRefresh, progress }) };
}

test('operator must explicitly start a local inspection; completion and interruption persist lifecycle', async () => {
  const store = memoryStore(); const repo = new DroneRepository(store);
  assert.equal(await repo.getActiveInspectionSession(), undefined);
  const created = await repo.startInspection(field.id, 'drone-1', at);
  assert.equal(created.status, 'active'); assert.equal(created.fieldId, field.id); assert.equal(created.sessionType, 'inspection');
  assert.equal((await repo.endInspection(created.id, 'completed', '2026-09-28T10:08:00.000Z')).status, 'completed');
  const second = await repo.startInspection(field.id, 'drone-1', '2026-09-28T11:00:00.000Z');
  assert.equal((await repo.endInspection(second.id, 'interrupted', '2026-09-28T11:03:00.000Z')).status, 'interrupted');
});

test('inspection session remains active on telemetry disconnect or disarmed report and records only fresh valid track points', async () => {
  const store = memoryStore(); const repo = new DroneRepository(store); const session = await repo.startInspection(field.id, 'drone-1', at);
  await repo.markDisconnected('2026-09-28T10:00:01.000Z');
  await repo.recordTelemetry(parseTelemetryJson({ ...telemetryContract, timestamp: 101, armed: false }, '2026-09-28T10:00:02.000Z'));
  assert.equal((await repo.getActiveInspectionSession()).id, session.id);
  assert.equal((await repo.getTrack(session.id)).length, 1);
});

test('capture saves a real-shaped on-device observation with fresh drone GPS, field and session association, then refreshes existing advisory/alert pipelines', async () => {
  const ctx = setup(); const outcome = await ctx.service.capture(field, ctx.session);
  assert.equal(outcome.observation.fieldId, field.id); assert.equal(outcome.observation.farmId, field.farmId);
  assert.equal(outcome.observation.flightSessionId, ctx.session.id); assert.equal(outcome.observation.source, 'esp32_cam_rgb');
  assert.equal(outcome.observation.locationSource, 'drone'); assert.deepEqual(outcome.observation.location, { latitude: 12.005, longitude: 76.005 });
  assert.equal(outcome.observation.droneContext.altitudeM, 41); assert.equal(outcome.observation.droneTelemetryAt, at);
  assert.equal(outcome.observation.verificationStatus, 'requires_verification');
  assert.equal((await ctx.observations.listObservations(field.id)).length, 1);
  assert.deepEqual(ctx.counts(), { captures: 1, analyses: 1, advisoryRefresh: 1, alertRefresh: 1, progress: undefined });
});

test('camera disconnect prevents capture and persistence while leaving the session untouched', async () => {
  const ctx = setup({ cameraConnected: false });
  await assert.rejects(() => ctx.service.capture(field, ctx.session), InspectionCameraUnavailableError);
  assert.equal(ctx.counts().captures, 0); assert.equal(ctx.counts().analyses, 0); assert.equal((await ctx.observations.listObservations()).length, 0);
  assert.equal((await ctx.drone.getActiveInspectionSession()).id, ctx.session.id);
});

test('invalid quality/model output is not persisted and does not refresh alerts/advisories', async () => {
  const lowQuality = setup({ result: sampleResult({ imageQuality: { status: 'low', reason: 'blurred' } }) });
  await assert.rejects(() => lowQuality.service.capture(field, lowQuality.session), InspectionResultInvalidError);
  assert.equal((await lowQuality.observations.listObservations()).length, 0);
  assert.equal(lowQuality.counts().advisoryRefresh, 0); assert.equal(lowQuality.counts().alertRefresh, 0);
  const invalid = setup({ result: sampleResult({ inferenceValidated: false }) });
  await assert.rejects(() => invalid.service.capture(field, invalid.session), InspectionResultInvalidError);
  assert.equal((await invalid.observations.listObservations()).length, 0);
});

test('fresh connected telemetry without GPS allows capture but does not attach drone coordinates or phone location', async () => {
  const noGps = parseTelemetryJson({ ...telemetryContract, timestamp: 100, latitude: null, longitude: null, gps_fix: 0 }, at);
  const ctx = setup({ telemetry: noGps }); const { observation } = await ctx.service.capture(field, ctx.session);
  assert.equal(observation.location, undefined); assert.equal(observation.locationSource, undefined);
  assert.equal(observation.droneContext.latitude, undefined); assert.equal(observation.droneContext.longitude, undefined);
  assert.equal(observation.droneContext.altitudeM, 41); assert.equal(observation.droneContext.batteryPercent, 78);
  assert.equal(observation.fieldId, field.id);
});

test('stale/disconnected/simulated telemetry is rejected from capture context', () => {
  const stale = parseTelemetryJson({ ...telemetryContract, timestamp: 100 }, '2026-09-28T09:59:00.000Z');
  const disconnected = { ...parseTelemetryJson({ ...telemetryContract, timestamp: 100 }, at), connectionState: 'disconnected' };
  const simulated = { ...parseTelemetryJson({ ...telemetryContract, timestamp: 100 }, at), source: 'simulated' };
  for (const value of [stale, disconnected, simulated]) {
    const context = createInspectionCaptureContext({ telemetry: value, field, session: { id: 's', droneId: 'drone-1', fieldId: field.id, sessionType: 'inspection', startedAt: at, endedAt: null, status: 'active', telemetryCount: 0, observationCount: 0, syncState: 'local' }, capturedAt: at });
    assert.equal(context.telemetry, undefined); assert.equal(context.location, undefined); assert.equal(context.enrichment.droneContext, undefined);
  }
});

test('geofence is informational for inside/outside and unknown without position', () => {
  assert.equal(evaluateFieldGeofence(boundary, { latitude: 12.005, longitude: 76.005 }), 'inside');
  assert.equal(evaluateFieldGeofence(boundary, { latitude: 12.02, longitude: 76.02 }), 'outside');
  assert.equal(evaluateFieldGeofence(boundary, undefined), 'unknown');
});

test('targeted closer inspection is a local scouting task and does not execute aircraft actions', async () => {
  const store = memoryStore(); const scouting = new ScoutingRepository(store);
  const zone = { id: 'zone-1', fieldId: field.id, center: { latitude: 12.005, longitude: 76.005 }, observationIds: ['obs-1'], status: 'inspection_suggested', severity: 'inspection_suggested', createdAt: at, updatedAt: at };
  await store.save('scouting-zone', zone);
  const task = await scouting.requestTargetedRescan(field.id, zone.id, zone.observationIds);
  assert.equal(task.status, 'rescan_requested'); assert.equal(task.syncState, 'local');
  assert.equal((await store.list('scouting-task')).length, 1);
  assert.equal('arm' in scouting, false); assert.equal('takeoff' in scouting, false); assert.equal('setMode' in scouting, false);
});

test('English and Hindi inspection strings are available', () => {
  for (const key of ['droneInspection', 'droneStart', 'droneEnd', 'droneCaptureImage', 'droneCameraUnavailable', 'droneTelemetryUnavailable', 'droneGpsUnavailable', 'droneInsideField', 'droneOutsideField', 'droneInspectionComplete', 'droneImagesCaptured', 'droneObservationsFound', 'droneInspectionZones']) {
    assert.ok(translate('en', key)); assert.ok(translate('hi', key));
  }
  assert.match(translate('en', 'droneReadOnlyNote'), /does not|controls/i);
  assert.match(translate('hi', 'droneReadOnlyNote'), /नियंत्रण/);
});
