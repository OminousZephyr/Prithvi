import assert from 'node:assert/strict';
import test from 'node:test';

import { AIRepository } from '../../src/features/ai/ai-repository.ts';

const scans = () => {
  const rows = new Map();
  return { rows, repository: new AIRepository({
    async list(type) { return type === 'crop-observation' ? [...rows.values()] : []; },
    async get(type, id) { return type === 'crop-observation' ? rows.get(id) : undefined; },
    async save(type, row) { rows.set(row.id, row); return row; },
  }) };
};
const result = (overrides = {}) => ({ status: 'possible_issue', crop: 'Tomato', condition: 'Early blight', confidence: 0.84, observation: 'Possible crop-health issue', modelVersion: 'MobileNetV3Large-PlantVillage-38-quantized-v1', rawLabel: 'Tomato___Early_blight', source: 'esp32_cam_rgb', imageQuality: { status: 'acceptable', reason: null }, timestamp: '2026-08-20T12:00:00.000Z', provider: 'on_device_ai', provenance: ['on_device_ai'], inferenceValidated: true, ...overrides });

test('converts an on-device AI result into an offline observation and retains AI provenance with sensor/GPS context', async () => {
  const { repository, rows } = scans();
  const saved = await repository.saveScan(result(), { fieldId: 'field-a', source: 'esp32_cam_rgb' }, 'file:///camera.jpg', {
    farmId: 'farm-a', latitude: 10.5, longitude: 76.5,
    sensorContext: { temperature: { value: 27.4, unit: '°C', timestamp: '2026-08-20T11:59:59.000Z', freshness: 'current' }, soilRaw: { value: 1820, unit: 'ADC count', timestamp: '2026-08-20T11:59:40.000Z', freshness: 'stale' } },
    droneContext: { droneId: 'drone-a', timestamp: '2026-08-20T11:59:58.000Z', freshness: 'current', altitudeM: 22, headingDegrees: 90, gpsFix: '3d' },
    droneId: 'drone-a', flightSessionId: 'flight-a', droneTelemetryAt: '2026-08-20T11:59:58.000Z', gpsFix: '3d', locationSource: 'drone',
  });
  assert.ok(saved);
  assert.equal(rows.size, 2); // Observation plus its local scouting-evidence record.
  assert.equal(saved.fieldId, 'field-a');
  assert.equal(saved.farmId, 'farm-a');
  assert.deepEqual(saved.location, { latitude: 10.5, longitude: 76.5 });
  assert.equal(saved.timestamp, result().timestamp);
  assert.equal(saved.rawModelLabel, 'Tomato___Early_blight');
  assert.equal(saved.sensorContext.soilRaw.value, 1820);
  assert.equal(saved.sensorContext.soilRaw.freshness, 'stale');
  assert.equal(saved.droneContext.altitudeM, 22);
  assert.equal(saved.droneId, 'drone-a');
  assert.equal(saved.flightSessionId, 'flight-a');
  assert.equal(saved.droneTelemetryAt, '2026-08-20T11:59:58.000Z');
  assert.equal(saved.gpsFix, '3d');
  assert.equal(saved.locationSource, 'drone');
  assert.equal(saved.source, 'esp32_cam_rgb');
  assert.ok(saved.provenance.includes('on_device_ai'));
  assert.ok(saved.provenance.includes('ground_sensor'));
  assert.ok(saved.provenance.includes('drone_telemetry'));
  assert.ok(saved.provenance.includes('fused'));
  assert.equal(saved.syncStatus, 'local');
  assert.equal(saved.verificationStatus, 'requires_verification');
});

test('supports no GPS and preserves low-confidence predictions as needs-verification observations', async () => {
  const { repository } = scans();
  const saved = await repository.saveScan(result({ status: 'uncertain', confidence: 0.42 }), { source: 'local_image' }, 'file:///local.jpg');
  assert.ok(saved);
  assert.equal(saved.location, undefined);
  assert.equal(saved.fieldId, undefined);
  assert.equal(saved.scanStatus, 'uncertain');
  assert.equal(saved.verificationStatus, 'requires_verification');
  assert.equal(saved.provenance.includes('on_device_ai'), true);
  assert.equal(saved.dataQuality, 'limited');
});

test('does not save unavailable, invalid, low-quality, or unmapped results', async () => {
  const { repository, rows } = scans();
  assert.equal(await repository.saveScan(result({ status: 'unavailable' }), {}, 'image'), undefined);
  assert.equal(await repository.saveScan(result({ imageQuality: { status: 'low', reason: 'small' } }), {}, 'image'), undefined);
  assert.equal(await repository.saveScan(result({ rawLabel: undefined }), {}, 'image'), undefined);
  assert.equal(await repository.saveScan(result({ confidence: Number.NaN }), {}, 'image'), undefined);
  assert.equal(await repository.saveScan(result({ provider: 'optional_local_server' }), {}, 'image'), undefined);
  assert.equal(await repository.saveScan(result({ inferenceValidated: false }), {}, 'image'), undefined);
  assert.equal(rows.size, 0);
});

test('verification changes are explicit records and do not rewrite the AI health result', async () => {
  const { repository } = scans();
  const saved = await repository.saveScan(result(), {}, 'file:///camera.jpg');
  const verified = await repository.updateObservationVerification(saved.id, 'verified', 'Checked leaf in field');
  assert.equal(verified.verificationStatus, 'verified');
  assert.equal(verified.verificationNote, 'Checked leaf in field');
  assert.ok(verified.verifiedAt);
  assert.equal(verified.scanStatus, 'possible_issue');
  assert.equal(verified.condition, 'Early blight');
  assert.equal(verified.syncStatus, 'pending');
  const reset = await repository.updateObservationVerification(saved.id, 'requires_verification');
  assert.equal(reset.verificationStatus, 'requires_verification');
  assert.equal(reset.verifiedAt, undefined);
});

test('filters persisted observations by farm, field, date, source, crop, and status', async () => {
  const { repository } = scans();
  const observation = await repository.saveScan(result(), { fieldId: 'field-a' }, 'file:///camera.jpg', { farmId: 'farm-a' });
  assert.equal((await repository.listObservations({ farmId: 'farm-a', fieldId: 'field-a', from: '2026-08-20', to: '2026-08-21', source: 'esp32_cam_rgb', crop: 'tomato', status: 'possible_issue' })).length, 1);
  assert.equal((await repository.listObservations({ fieldId: 'field-b' })).length, 0);
  assert.equal((await repository.listObservations({ from: '2026-08-21' })).length, 0);
  assert.equal((await repository.getObservation(observation.id)).id, observation.id);
});
