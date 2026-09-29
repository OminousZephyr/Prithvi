import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildHomeSensorSummary, buildSensorGrid } from '../../src/features/sensors/presentation/sensor-presentation.ts';
import { translate } from '../../src/localization/resources.ts';

const now = Date.parse('2026-01-01T00:00:00Z');
const connection = { transport: 'wifi', status: 'connected' };
const sensors = [
  { id: 't', kind: 'temperature' }, { id: 'h', kind: 'humidity' },
  { id: 's', kind: 'soil_moisture' }, { id: 'r', kind: 'rain' },
];
function reading(sensorId, value, { age = 1000, quality = 'valid', source = 'device_wifi' } = {}) {
  return { id: sensorId, sensorId, deviceId: 'real-esp', value, receivedAt: new Date(now - age).toISOString(), quality, source };
}

test('sensor grid displays four fresh real readings as live', () => {
  const grid = buildSensorGrid([reading('t', 28.4), reading('h', 63), reading('s', 1840), reading('r', 3200)], sensors, connection, now);
  assert.deepEqual(grid.map((card) => card.state), ['live', 'live', 'live', 'live']);
  assert.deepEqual(grid.map((card) => card.value), [28.4, 63, 1840, 3200]);
  assert.equal(grid[2].raw, true);
  assert.equal(grid[3].raw, true);
});

test('same-kind sensors remain separate and preserve zone source', () => {
  const cards = buildSensorGrid([reading('north', 1840), { ...reading('south', 2120), zonePosition: 'South Zone' }], [
    { id: 'north', kind: 'soil_moisture', zonePosition: 'North Zone' }, { id: 'south', kind: 'soil_moisture' },
  ], connection, now).filter((card) => card.kind === 'soil_moisture');
  assert.deepEqual(cards.map((card) => card.value), [1840, 2120]);
  assert.deepEqual(cards.map((card) => card.position), ['North Zone', 'South Zone']);
});

test('stale readings are marked stale and not live', () => {
  const grid = buildSensorGrid([reading('t', 27, { age: 20_000 })], sensors, connection, now);
  assert.equal(grid[0].state, 'stale');
  assert.equal(grid[0].value, 27);
  assert.equal(grid[1].state, 'unavailable');
});

test('disconnected readings have their own state and are not shown as current', () => {
  const grid = buildSensorGrid([reading('t', 27)], sensors, { ...connection, status: 'disconnected' }, now);
  assert.equal(grid[0].state, 'disconnected');
  assert.equal(grid[0].value, 27, 'keep the last actual value visible with a disconnected state');
});

test('invalid, missing, and simulated sensor values are never presented as real', () => {
  const grid = buildSensorGrid([reading('t', 0, { quality: 'invalid' }), reading('h', 50, { source: 'simulated' })], sensors, connection, now);
  assert.equal(grid[0].value, undefined);
  assert.equal(grid[0].state, 'unavailable');
  assert.equal(grid[1].value, undefined);
  assert.equal(grid[2].value, undefined);
});

test('raw soil and rain ADC readings have no inferred meaning', () => {
  const [soil, rain] = buildSensorGrid([reading('s', 1840), reading('r', 3200)], sensors, connection, now).slice(2);
  assert.equal(soil.value, 1840); assert.equal(soil.raw, true);
  assert.equal(rain.value, 3200); assert.equal(rain.raw, true);
  assert.equal(soil.state, 'live'); assert.equal(rain.state, 'live');
});

test('Home sensor summary keeps cached real readings and marks their state', () => {
  assert.equal(buildHomeSensorSummary([], sensors, connection, now), undefined);
  assert.equal(buildHomeSensorSummary([reading('t', 28)], sensors, { ...connection, status: 'disconnected' }, now), '28°C · disconnected');
  assert.equal(buildHomeSensorSummary([reading('t', 28, { age: 20_000 })], sensors, connection, now), '28°C · stale');
  assert.equal(buildHomeSensorSummary([reading('t', 28)], sensors, connection, now), '28°C');
});

test('new farmer sensor strings have English and Hindi translations', () => {
  for (const key of ['sensorLive', 'sensorStaleState', 'sensorUnavailable', 'sensorDetails', 'sensorLastUpdated', 'sensorOverallConnected', 'sensorOverallStale', 'sensorOverallUnavailable', 'sensorRawExplanation']) {
    assert.ok(translate('en', key)); assert.ok(translate('hi', key));
  }
});

test('optional AI server controls are only present in developer diagnostics', async () => {
  const settings = await readFile(new URL('../../src/app/settings.tsx', import.meta.url), 'utf8');
  const diagnostics = await readFile(new URL('../../src/app/diagnostics.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(settings, /optionalAIProvider|Optional AI server|aiAddress|fallbackEnabled/);
  assert.match(diagnostics, /optionalAIProvider/);
  assert.match(diagnostics, /setOptionalServerFallbackEnabled/);
});
