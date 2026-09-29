import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDroneContext, buildSensorContext, findContainingField } from '../../src/features/observations/observation-context.ts';

const now = '2026-08-20T12:00:00.000Z';
const sensor = (kind, id = kind) => ({ id, nodeId: 'esp32', kind, label: kind, unit: kind === 'temperature' ? '°C' : kind === 'humidity' ? '% RH' : 'ADC count' });
const reading = (sensorId, value, receivedAt, quality = 'valid') => ({ id: `${sensorId}:${receivedAt}`, sensorId, deviceId: 'esp32', value, unit: 'ADC count', observedAt: receivedAt, receivedAt, source: 'device_wifi', quality, syncState: 'local' });

test('attaches only valid sensor values, retains timestamps, and labels stale data without interpreting raw ADC values', () => {
  const sensors = [sensor('temperature'), sensor('humidity'), sensor('soil_moisture'), sensor('rain')];
  const records = [
    reading('temperature', 27.4, '2026-08-20T11:59:59.000Z'),
    reading('humidity', 62.1, '2026-08-20T11:59:59.000Z'),
    reading('soil_moisture', 1820, '2026-08-20T11:59:40.000Z'),
    reading('rain', 3100, '2026-08-20T11:59:59.000Z', 'invalid'),
  ];
  const context = buildSensorContext(sensors, records, now);
  assert.equal(context.temperature.value, 27.4);
  assert.equal(context.temperature.freshness, 'current');
  assert.equal(context.temperature.timestamp, records[0].observedAt);
  assert.equal(context.soilRaw.value, 1820);
  assert.equal(context.soilRaw.freshness, 'stale');
  assert.equal(context.rainRaw, undefined);
  assert.equal(context.humidity.value, 62.1);
});

test('returns no context when readings or telemetry are unavailable and omits bad values', () => {
  assert.equal(buildSensorContext([], [], now), undefined);
  assert.equal(buildSensorContext([sensor('temperature')], [reading('temperature', Number.NaN, now)], now), undefined);
  assert.equal(buildDroneContext([], now), undefined);
});

test('does not attach stale telemetry and includes fresh connected telemetry', () => {
  const stale = { id: 't1', droneId: 'drone-1', latitude: 10.1, longitude: 76.2, altitudeM: 22, headingDegrees: 90, speedMps: 4, batteryPercent: 70, satellites: 8, observedAt: '2026-08-20T11:55:00.000Z', receivedAt: '2026-08-20T11:55:00.000Z', connectionState: 'connected', source: 'device_wifi', syncState: 'local' };
  assert.equal(buildDroneContext([stale], now), undefined);
  const fresh = buildDroneContext([{ ...stale, observedAt: now, receivedAt: now }], now);
  assert.equal(fresh.freshness, 'current');
  assert.equal(fresh.latitude, 10.1);
  assert.equal(fresh.altitudeM, 22);
  assert.equal(fresh.batteryPercent, 70);
});

test('associates only a point actually inside a recorded field boundary', () => {
  const fields = [{ id: 'field-a', farmId: 'farm-a', name: 'A', boundary: [{ latitude: 10, longitude: 76 }, { latitude: 10, longitude: 77 }, { latitude: 11, longitude: 77 }, { latitude: 11, longitude: 76 }], sensorNodeIds: [], observationIds: [], healthStatus: 'unassessed', createdAt: now, syncState: 'local' }];
  assert.equal(findContainingField({ latitude: 10.5, longitude: 76.5 }, fields).id, 'field-a');
  assert.equal(findContainingField({ latitude: 12, longitude: 76.5 }, fields), undefined);
  assert.equal(findContainingField({ latitude: 10.5, longitude: 76.5 }, [{ ...fields[0], boundary: undefined }]), undefined);
});
