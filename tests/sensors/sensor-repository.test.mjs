import test from 'node:test';
import assert from 'node:assert/strict';
import { createSensorRepository } from '../../src/features/sensors/sensor-repository-core.ts';

function createMemoryStore() {
  const tables = new Map();
  return {
    async list(type) { return [...(tables.get(type)?.values() ?? [])]; },
    async get(type, id) { return tables.get(type)?.get(id); },
    async save(type, value) {
      const table = tables.get(type) ?? new Map();
      table.set(value.id, structuredClone(value)); tables.set(type, table);
      return value;
    },
  };
}

test('stores received values and explicit unavailable fields as local historical records', async () => {
  const repository = createSensorRepository(createMemoryStore());
  const receivedAt = new Date().toISOString();
  await repository.saveFrame('PRITHVI-ESP32-01', receivedAt, {
    temperature: { value: 27.4, quality: 'valid' },
    humidity: { value: 62.1, quality: 'valid' },
    soil_moisture: { value: 1842, quality: 'valid' },
    rain: { quality: 'invalid', detail: 'Reading unavailable from device' },
  });

  const latest = await repository.latestReadings();
  assert.equal(latest.length, 4);
  const soil = latest.find((reading) => reading.sensorId.endsWith(':soil_moisture'));
  const rain = latest.find((reading) => reading.sensorId.endsWith(':rain'));
  assert.equal(soil?.value, 1842);
  assert.equal(soil?.unit, 'ADC count');
  assert.equal(soil?.source, 'device');
  assert.equal(soil?.receivedAt, receivedAt);
  assert.equal(rain?.value, undefined);
  assert.equal(rain?.quality, 'invalid');
  assert.equal((await repository.history(undefined, 2)).length, 2);
  assert.equal((await repository.listNodes())[0]?.status, 'online');
  const health = await repository.listHealth();
  assert.equal(health.find((item) => item.sensorId.endsWith(':soil_moisture'))?.status, 'uncalibrated');
});

test('persists the next frame without replacing reading history', async () => {
  const repository = createSensorRepository(createMemoryStore());
  const base = Date.now();
  for (const seconds of [0, 2]) {
    const at = new Date(base + seconds * 1000).toISOString();
    await repository.saveFrame('node-2', at, { temperature: { value: 24 + seconds, quality: 'valid' } });
  }
  const temperature = await repository.history('node-2:temperature');
  assert.equal(temperature.length, 2);
  assert.equal((await repository.latestReadings()).find((r) => r.sensorId.endsWith(':temperature'))?.value, 26);
});

test('preserves ESP32 Wi-Fi provenance and device uptime separately from phone receive time', async () => {
  const repository = createSensorRepository(createMemoryStore());
  const receivedAt = new Date().toISOString();
  await repository.saveFrame('PRITHVI-ESP32-01', receivedAt, { temperature: { value: 27.6, quality: 'valid' } }, 38716, 'device_wifi');
  const reading = (await repository.latestReadings()).find((item) => item.sensorId.endsWith(':temperature'));
  assert.equal(reading?.source, 'device_wifi');
  assert.equal(reading?.receivedAt, receivedAt);
  assert.equal(reading?.deviceTimestamp, 38716);
});
