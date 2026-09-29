import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteEntityStore } from '../../src/data/storage/sqlite-entity-store.ts';
import { createSensorRepository } from '../../src/features/sensors/sensor-repository-core.ts';
import { AIRepository } from '../../src/features/ai/ai-repository.ts';
import { AdvisoryRepository } from '../../src/features/advisory/advisory-repository.ts';

test('writes sensor frames and history through the same SQLite entity-store adapter as the app', async () => {
  const database = new DatabaseSync(':memory:');
  const store = createSqliteEntityStore(async () => ({
    async execAsync(sql) { database.exec(sql); },
    async getAllAsync(sql, ...params) { return database.prepare(sql).all(...params); },
    async getFirstAsync(sql, ...params) { return database.prepare(sql).get(...params) ?? null; },
    async runAsync(sql, ...params) { return database.prepare(sql).run(...params); },
  }));
  const repository = createSensorRepository(store);
  const start = Date.now();
  for (const offset of [0, 2000]) {
    const receivedAt = new Date(start + offset).toISOString();
    await repository.saveFrame('device-real-protocol', receivedAt, {
      temperature: { value: 25 + offset / 1000, quality: 'valid' },
      humidity: { value: 55, quality: 'valid' },
      soil_moisture: { value: 1700, quality: 'valid' },
      rain: { quality: 'invalid', detail: 'Reading unavailable from device' },
    });
  }

  assert.equal((await repository.history(undefined, 20)).length, 8);
  assert.equal((await repository.latestReadings()).length, 4);
  assert.equal((await repository.latestReadings()).find((reading) => reading.sensorId.endsWith(':temperature'))?.value, 27);
  assert.equal((await repository.latestReadings()).find((reading) => reading.sensorId.endsWith(':rain'))?.quality, 'invalid');
  const counts = await store.syncCounts();
  assert.equal(counts.pending, 17);

  const aiRepository = new AIRepository(store);
  const observation = await aiRepository.saveScan({
    status: 'possible_issue', crop: 'unknown', condition: 'unknown', confidence: 0.81,
    observation: 'Possible visible crop-health anomaly', modelVersion: 'MobileNetV3Large-PlantVillage-38-quantized-v1', rawLabel: 'Potato___Late_blight',
    source: 'local_image', provider: 'on_device_ai', inferenceValidated: true, provenance: ['on_device_ai'],
    imageQuality: { status: 'acceptable', reason: null }, timestamp: new Date(start).toISOString(),
  }, { fieldId: 'field-test', latitude: 10.1, longitude: 76.2 }, 'data:image/jpeg;base64,test-only', {
    farmId: 'farm-test', sensorContext: { temperature: { value: 27, unit: '°C', timestamp: new Date(start).toISOString(), freshness: 'current' }, soilRaw: { value: 1700, unit: 'ADC count', timestamp: new Date(start).toISOString(), freshness: 'stale' } },
  });
  const persisted = await store.get('crop-observation', observation.id);
  assert.equal(persisted.fieldId, 'field-test');
  assert.equal(persisted.farmId, 'farm-test');
  assert.equal(persisted.latitude, 10.1);
  assert.equal(persisted.sensorContext.soilRaw.value, 1700);
  assert.equal(persisted.rawModelLabel, 'Potato___Late_blight');
  assert.equal(persisted.provenance.includes('on_device_ai'), true);
  const evidence = await store.list('scouting-evidence');
  assert.equal(evidence.length, 1);
  assert.deepEqual(evidence[0].observationIds, [observation.id]);
  assert.equal(evidence[0].evidenceLevel, 'single_observation');
  await store.save('field', { id: 'field-test', farmId: 'farm-test', name: 'Field', crop: { id: 'tomato', name: 'Tomato' }, sensorNodeIds: [], observationIds: [observation.id], healthStatus: 'unassessed', createdAt: new Date(start).toISOString(), syncState: 'local' });
  await store.save('farm', { id: 'farm-test', name: 'Farm', fieldIds: ['field-test'], createdAt: new Date(start).toISOString(), syncState: 'local' });
  const advisoryRepository = new AdvisoryRepository(store);
  const advisories = await advisoryRepository.refresh(new Date(start + 1000).toISOString());
  assert.ok(advisories.some((item) => item.fieldId === 'field-test' && item.sourceObservationIds.includes(observation.id)));
  assert.ok((await store.list('risk-signal')).some((item) => item.type === 'possible_crop_health_issue'));
  const verified = await aiRepository.updateObservationVerification(observation.id, 'verified', 'Field check recorded');
  assert.equal((await store.get('crop-observation', observation.id)).verificationStatus, 'verified');
  assert.equal(verified.provenance.includes('manual'), true);
  assert.equal((await aiRepository.listObservations('field-test')).length, 1);
  assert.equal(await aiRepository.saveScan({
    status: 'unavailable', crop: 'unknown', condition: 'unknown', confidence: null,
    source: 'drone_rgb', imageQuality: { status: 'acceptable', reason: null }, timestamp: new Date(start).toISOString(),
  }, {}, 'image'), undefined);
  database.close();
});
