import assert from 'node:assert/strict';
import test from 'node:test';

import { ManualPhotoDiagnosticsService, isSavableManualPhotoResult, isUnsupportedManualPhoto } from '../../src/features/ai/manual-photo-service.ts';
import { translate } from '../../src/localization/resources.ts';
import { ScoutingEvidenceService } from '../../src/features/scouting/scouting-evidence.ts';
import { AIRepository } from '../../src/features/ai/ai-repository.ts';

const valid = (overrides = {}) => ({ status: 'possible_issue', crop: 'Tomato', condition: 'Early blight', confidence: 0.84, observation: 'Possible crop-health issue', modelVersion: 'MobileNetV3Large-PlantVillage-38-quantized-v1', rawLabel: 'Tomato___Early_blight', source: 'manual_photo', imageQuality: { status: 'acceptable', reason: null }, timestamp: '2026-09-29T10:00:00.000Z', provider: 'on_device_ai', provenance: ['on_device_ai'], inferenceValidated: true, ...overrides });

test('manual photo inference calls only the injected on-device provider with manual provenance', async () => {
  let calls = 0; let received;
  const provider = { async analyzeImage(uri, metadata) { calls++; received = { uri, metadata }; return valid(); } };
  const service = new ManualPhotoDiagnosticsService(provider, { async saveScan() { throw new Error('not expected'); } });
  const result = await service.analyze('file:///leaf.jpg', { fieldId: 'field-1', capturedAt: '2026-09-29T10:00:00.000Z' });
  assert.equal(calls, 1);
  assert.equal(received.uri, 'file:///leaf.jpg');
  assert.equal(received.metadata.source, 'manual_photo');
  assert.equal(result.source, 'manual_photo');
});

test('rejects invalid, unavailable, low-quality, server, or malformed results from saving', () => {
  assert.equal(isSavableManualPhotoResult(valid()), true);
  assert.equal(isSavableManualPhotoResult(valid({ status: 'unavailable' })), false);
  assert.equal(isSavableManualPhotoResult(valid({ imageQuality: { status: 'low', reason: 'small' } })), false);
  assert.equal(isSavableManualPhotoResult(valid({ provider: 'optional_local_server' })), false);
  assert.equal(isSavableManualPhotoResult(valid({ inferenceValidated: false })), false);
  assert.equal(isSavableManualPhotoResult(valid({ confidence: Number.NaN })), false);
});

test('saves a manual-photo observation with explicit field only and no automatic location', async () => {
  let args;
  const service = new ManualPhotoDiagnosticsService({ async analyzeImage() { return valid(); } }, { async saveScan(...values) { args = values; return { id: 'obs-1', source: 'manual_photo', verificationStatus: 'requires_verification' }; } });
  const field = { id: 'field-2', farmId: 'farm-2', crop: { growthStage: 'flowering' } };
  const saved = await service.save(valid(), 'file:///picked.jpg', '2026-09-29T10:00:00.000Z', field);
  assert.equal(saved.id, 'obs-1');
  assert.equal(args[1].source, 'manual_photo');
  assert.equal(args[1].fieldId, 'field-2');
  assert.equal(args[2], 'file:///picked.jpg');
  assert.deepEqual(args[3], { fieldId: 'field-2', farmId: 'farm-2', growthStage: 'flowering' });
  assert.equal(args[1].latitude, undefined);
  assert.equal(args[1].longitude, undefined);
});

test('an observation can be saved without a field or location', async () => {
  let args;
  const service = new ManualPhotoDiagnosticsService({ async analyzeImage() { return valid(); } }, { async saveScan(...values) { args = values; return { id: 'obs-unlocated' }; } });
  await service.save(valid(), 'file:///leaf.jpg', '2026-09-29T10:00:00.000Z');
  assert.equal(args[1].fieldId, undefined);
  assert.equal(args[1].latitude, undefined);
  assert.equal(args[1].longitude, undefined);
});

test('retains a valid location only when the caller explicitly selects one', async () => {
  let args;
  const service = new ManualPhotoDiagnosticsService({ async analyzeImage() { return valid(); } }, { async saveScan(...values) { args = values; return { id: 'obs-located' }; } });
  await service.save(valid(), 'file:///leaf.jpg', '2026-09-29T10:00:00.000Z', undefined, { point: { latitude: 10.25, longitude: 76.3 }, source: 'phone' });
  assert.equal(args[1].latitude, 10.25);
  assert.equal(args[1].longitude, 76.3);
  assert.equal(args[3].locationSource, 'phone');
});

test('AIRepository persists the manual photo source and verification without changing model output', async () => {
  const records = new Map();
  const repository = new AIRepository({ async list(type) { return [...records.values()].filter((row) => row.__type === type).map(({ __type, ...row }) => row); }, async get(type, id) { const item = records.get(id); return item?.__type === type ? item : undefined; }, async save(type, row) { records.set(row.id, { ...row, __type: type }); return row; } });
  const saved = await repository.saveScan(valid(), { source: 'manual_photo', capturedAt: valid().timestamp }, 'file:///local-photo.jpg');
  assert.equal(saved.source, 'manual_photo');
  assert.equal(saved.imageReference, 'file:///local-photo.jpg');
  assert.equal(saved.verificationStatus, 'requires_verification');
  assert.ok(saved.provenance.includes('on_device_ai'));
  const verified = await repository.updateObservationVerification(saved.id, 'verified');
  assert.equal(verified.verificationStatus, 'verified');
  assert.equal(verified.rawModelLabel, 'Tomato___Early_blight');
  assert.equal(verified.confidence, 0.84);
});

test('manual photo format checks reject unsupported file types without blocking JPEG', () => {
  assert.equal(isUnsupportedManualPhoto({ uri: 'file:///leaf.jpg', mimeType: 'image/jpeg' }), false);
  assert.equal(isUnsupportedManualPhoto({ uri: 'file:///leaf.heic', mimeType: 'image/heic' }), true);
  assert.equal(isUnsupportedManualPhoto({ uri: 'file:///leaf.png', mimeType: null }), true);
});

test('English and Hindi photo diagnostic text exists', () => {
  assert.equal(translate('en', 'photoTake'), 'Take photo');
  assert.equal(translate('hi', 'photoTake'), 'फोटो लें');
  assert.ok(translate('en', 'photoTryClearer').length > 0);
  assert.ok(translate('hi', 'photoTryClearer').length > 0);
});

test('manual and ESP32 camera observations are not automatically merged into the same evidence', async () => {
  const rows = new Map();
  const store = { async list(type) { return [...rows].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async save(type, value) { rows.set(`${type}:${value.id}`, value); return value; } };
  const observation = (id, source, timestamp) => ({ id, fieldId: 'field-1', crop: 'Tomato', condition: 'Early blight', rawModelLabel: 'Tomato___Early_blight', confidence: 0.84, scanStatus: 'possible_issue', imageQuality: 'acceptable', verificationStatus: 'requires_verification', source, latitude: 10, longitude: 20, observedAt: timestamp, timestamp });
  const first = observation('drone-1', 'esp32_cam_rgb', '2026-09-29T09:00:00.000Z');
  rows.set('crop-observation:drone-1', first);
  await new ScoutingEvidenceService(store).recordObservation(first, '2026-09-29T10:00:00.000Z');
  const manual = observation('manual-1', 'manual_photo', '2026-09-29T09:30:00.000Z');
  rows.set('crop-observation:manual-1', manual);
  const evidence = await new ScoutingEvidenceService(store).recordObservation(manual, '2026-09-29T10:00:00.000Z');
  assert.deepEqual(evidence.observationIds, ['manual-1']);
  assert.equal(evidence.observationCount, 1);
  const manualRepeat = observation('manual-2', 'manual_photo', '2026-09-29T09:45:00.000Z');
  rows.set('crop-observation:manual-2', manualRepeat);
  const repeatedEvidence = await new ScoutingEvidenceService(store).recordObservation(manualRepeat, '2026-09-29T10:01:00.000Z');
  assert.equal(repeatedEvidence.observationCount, 2);
  assert.deepEqual(new Set(repeatedEvidence.observationIds), new Set(['manual-1', 'manual-2']));
});
