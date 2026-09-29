import assert from 'node:assert/strict';
import test from 'node:test';

import { ScoutingEvidenceService, haversineMeters } from '../../src/features/scouting/scouting-evidence.ts';
import { ScoutingRepository } from '../../src/features/scouting/scouting-repository.ts';
import { evaluateZoneInspectionAlert } from '../../src/features/observations/inspection-alert-evaluator.ts';

const baseTime = '2026-09-29T08:00:00.000Z';
function obs(id, overrides = {}) {
  return { id, fieldId: 'field-a', crop: 'Tomato', condition: 'Early blight', rawModelLabel: 'Tomato___Early_blight', latitude: 12, longitude: 76, timestamp: baseTime, observedAt: baseTime, source: 'esp32_cam_rgb', scanStatus: 'possible_issue', confidence: 0.72, verificationStatus: 'requires_verification', imageQuality: 'acceptable', syncState: 'local', ...overrides };
}
function store(initial = {}) {
  const rows = new Map(Object.entries(initial).flatMap(([type, items]) => items.map((value) => [`${type}:${value.id}`, value])));
  return { async list(type) { return [...rows].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async get(type, id) { return rows.get(`${type}:${id}`); }, async save(type, value) { rows.set(`${type}:${value.id}`, value); return value; } };
}

test('one valid located observation creates single-observation evidence and preserves its confidence', async () => {
  const storeDb = store({ 'crop-observation': [obs('one')] });
  const evidence = await new ScoutingEvidenceService(storeDb).recordObservation(obs('one'), baseTime);
  assert.equal(evidence.evidenceLevel, 'single_observation');
  assert.deepEqual(evidence.observationIds, ['one']);
  assert.deepEqual(evidence.confidenceRange, { min: 0.72, max: 0.72 });
});

test('same field, crop and raw condition within Haversine radius and time group; distinct times corroborate without averaging', async () => {
  const one = obs('one');
  const two = obs('two', { latitude: 12.0001, timestamp: '2026-09-29T08:05:00.000Z', observedAt: '2026-09-29T08:05:00.000Z', confidence: 0.86 });
  const db = store({ 'crop-observation': [one, two] });
  const service = new ScoutingEvidenceService(db);
  await service.recordObservation(one, baseTime);
  const evidence = await service.recordObservation(two, '2026-09-29T08:05:00.000Z');
  assert.equal(evidence.evidenceLevel, 'corroborated');
  assert.deepEqual(evidence.confidenceRange, { min: 0.72, max: 0.86 });
  assert.equal(evidence.observationCount, 2);
  assert.ok(haversineMeters({ latitude: 12, longitude: 76 }, { latitude: 12.0001, longitude: 76 }) < 50);
  assert.ok(haversineMeters({ latitude: 12, longitude: 76 }, { latitude: 12.01, longitude: 76 }) > 50);
});

test('different field, crop, condition, distant point, expired time, missing GPS, low confidence and poor quality do not corroborate', async () => {
  const first = obs('first');
  const candidates = [
    obs('field', { fieldId: 'field-b' }), obs('crop', { crop: 'Potato' }), obs('condition', { rawModelLabel: 'Tomato___Leaf_spot' }),
    obs('far', { latitude: 12.01 }), obs('old', { timestamp: '2026-09-27T08:00:00.000Z' }),
    obs('nogps', { latitude: undefined, longitude: undefined }), obs('low', { confidence: 0.5 }), obs('poor', { imageQuality: 'low' }),
  ];
  const db = store({ 'crop-observation': [first, ...candidates] });
  const result = await new ScoutingEvidenceService(db).recordObservation(first, baseTime);
  assert.deepEqual(result.observationIds, ['first']);
});

test('same timestamp is repeated rather than corroborated; missing location cannot produce evidence', async () => {
  const a = obs('a'); const b = obs('b', { confidence: 0.91 });
  const db = store({ 'crop-observation': [a, b] }); const service = new ScoutingEvidenceService(db);
  await service.recordObservation(a, baseTime);
  assert.equal((await service.recordObservation(b, baseTime)).evidenceLevel, 'repeated_observation');
  assert.equal(await service.recordObservation(obs('no-coords', { latitude: undefined, longitude: undefined }), baseTime), undefined);
});

test('rescan comparison describes model outputs and poor image quality is unusable', async () => {
  const original = obs('original'); const task = { sourceObservationIds: ['original'], observationIds: ['original'] };
  const service = new ScoutingEvidenceService(store({ 'crop-observation': [original] }));
  assert.equal(await service.compareRescan(task, obs('repeat', { confidence: 0.9 })), 'issue_repeated');
  assert.equal(await service.compareRescan(task, obs('healthy', { scanStatus: 'healthy_looking' })), 'issue_not_reproduced');
  assert.equal(await service.compareRescan(task, obs('changed', { rawModelLabel: 'Tomato___Late_blight' })), 'result_changed');
  assert.equal(await service.compareRescan(task, obs('uncertain', { scanStatus: 'uncertain' })), 'still_uncertain');
  assert.equal(await service.compareRescan(task, obs('blurry', { imageQuality: 'low' })), 'rescan_unusable');
});

test('task lifecycle persists local requests, only completes with saved result, and verification state is explicit', async () => {
  const zone = { id: 'zone-a', fieldId: 'field-a', center: { latitude: 12, longitude: 76 }, observationIds: ['a', 'b'], status: 'inspection_suggested', severity: 'inspection_suggested', createdAt: baseTime, updatedAt: baseTime };
  const db = store({ 'scouting-zone': [zone], 'crop-observation': [obs('a'), obs('b', { latitude: 12.0001, timestamp: '2026-09-29T08:03:00.000Z' })] });
  const repo = new ScoutingRepository(db);
  await repo.evidenceService.recordObservation(obs('a'), baseTime);
  await repo.evidenceService.recordObservation(obs('b', { latitude: 12.0001, timestamp: '2026-09-29T08:03:00.000Z' }), '2026-09-29T08:03:00.000Z');
  const task = await repo.requestTargetedRescan('field-a', 'zone-a', ['a', 'b']);
  assert.equal(task.status, 'rescan_requested'); assert.equal(task.reason, 'Inspection suggested by nearby field observations'); assert.ok(await db.get('scouting-task', task.id));
  await repo.startRescan(task.id); assert.equal((await repo.listTasks())[0].status, 'rescan_in_progress');
  const saved = obs('rescan', { timestamp: '2026-09-29T08:08:00.000Z' }); await db.save('crop-observation', saved);
  await repo.completeRescan(task.id, saved); assert.equal((await repo.listTasks())[0].status, 'needs_verification');
  assert.equal((await repo.listTasks())[0].lastRescanOutcome, 'issue_repeated');
  assert.ok((await repo.listTasks())[0].evidenceUpdatedAt);
  const evidence = await repo.listEvidence('field-a'); await repo.evidenceService.setVerification(evidence[0].id, 'dismissed');
  assert.equal((await repo.listEvidence())[0].status, 'dismissed');
});

test('inspection reminder is deduplicated per active zone and suppressed after verification/dismissal', () => {
  const alert = { id: 'old', zoneId: 'zone-a', status: 'open' };
  const item = obs('new', { provenance: ['on_device_ai'] });
  assert.equal(evaluateZoneInspectionAlert(item, 'zone-a', [alert], 'inspection_suggested'), undefined);
  assert.equal(evaluateZoneInspectionAlert(item, 'zone-a', [], 'verified'), undefined);
  assert.equal(evaluateZoneInspectionAlert(item, 'zone-a', [], 'dismissed'), undefined);
  assert.equal(evaluateZoneInspectionAlert(item, 'zone-a', [], 'inspection_suggested').zoneId, 'zone-a');
  const later = obs('later', { timestamp: '2026-09-29T09:00:00.000Z', provenance: ['on_device_ai'] });
  const followup = evaluateZoneInspectionAlert(later, 'zone-a', [{ id: 'old', zoneId: 'zone-a', status: 'dismissed' }], 'inspection_suggested');
  assert.match(followup.dedupeKey, /:event:later$/);
});
