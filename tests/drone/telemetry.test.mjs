import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTelemetryJson, gpsFixFromCode, mapMavlinkMessage } from '../../src/features/drone/telemetry-parser.ts';
import { isTelemetryFresh, telemetryScreenState } from '../../src/features/drone/drone-status.ts';
import { DroneRepository } from '../../src/features/drone/drone-repository.ts';
import { LocalWifiDroneProvider } from '../../src/features/drone/local-wifi-drone-provider.ts';

const now = '2026-09-26T10:00:00.000Z';
const contract = { drone_id: 'PRITHVI-DRONE-01', timestamp: 1234, latitude: 12.3, longitude: 76.5, altitude: 41, relative_altitude: 12, ground_speed: 5.8, heading: 127, battery_voltage: 11.7, battery_percent: 78, satellites: 11, armed: true, flight_mode: 'STABILIZE', gps_fix: 3, connection: 'connected' };
function memoryStore() {
  const entries = new Map();
  return { entries, async list(type) { return [...entries.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async get(type, id) { return entries.get(`${type}:${id}`); }, async save(type, value) { entries.set(`${type}:${value.id}`, value); return value; } };
}

test('parses telemetry contract with receive time distinct from device timestamp', () => {
  const parsed = parseTelemetryJson(contract, now);
  assert.equal(parsed.droneId, 'PRITHVI-DRONE-01'); assert.equal(parsed.receivedAt, now); assert.equal(parsed.deviceTimestamp, 1234);
  assert.equal(parsed.gpsFix, '3d'); assert.equal(parsed.latitude, 12.3); assert.equal(parsed.source, 'device_wifi');
});
test('nullable/missing fields remain unavailable and invalid coordinates are omitted', () => {
  const parsed = parseTelemetryJson({ drone_id: 'drone', latitude: 91, longitude: 0, altitude: '0', satellites: 4 }, now);
  assert.equal(parsed.latitude, null); assert.equal(parsed.longitude, null); assert.equal(parsed.altitudeM, null); assert.equal(parsed.armed, null); assert.equal(parsed.satellites, 4);
  assert.equal(parseTelemetryJson({ drone_id: 'drone', latitude: null, longitude: null }, now).gpsFix, 'unknown');
  assert.throws(() => parseTelemetryJson('{bad', now), /valid JSON/i);
  assert.throws(() => parseTelemetryJson({ latitude: 1 }, now), /drone ID/i);
});
test('GPS fix is mapped from fix_type, not satellite count; validates battery and flight values', () => {
  assert.equal(gpsFixFromCode(0), 'no_fix'); assert.equal(gpsFixFromCode(2), '2d'); assert.equal(gpsFixFromCode(3), '3d'); assert.equal(gpsFixFromCode(4), 'dgps'); assert.equal(gpsFixFromCode(5), 'rtk_float'); assert.equal(gpsFixFromCode(6), 'rtk_fixed'); assert.equal(gpsFixFromCode(null), 'unknown');
  const parsed = parseTelemetryJson({ ...contract, gps_fix: 0, satellites: 20, battery_percent: 140, heading: 400 }, now);
  assert.equal(parsed.gpsFix, 'no_fix'); assert.equal(parsed.satellites, 20); assert.equal(parsed.batteryPercent, null); assert.equal(parsed.headingDegrees, null);
});
test('MAVLink telemetry mappings remain read-only and map requested fields', () => {
  assert.deepEqual(mapMavlinkMessage({ type: 'GLOBAL_POSITION_INT', lat: 123000000, lon: 760000000, alt: 42000, relative_alt: 12000, vx: 300, vy: 400, hdg: 12700 }), { latitude: 12.3, longitude: 76, altitudeM: 42, relativeAltitudeM: 12, speedMps: 5, headingDegrees: 127 });
  assert.deepEqual(mapMavlinkMessage({ type: 'SYS_STATUS', voltage_battery: 11700, battery_remaining: 78 }), { batteryVoltage: 11.7, batteryPercent: 78 });
  assert.deepEqual(mapMavlinkMessage({ type: 'HEARTBEAT', base_mode: 128, custom_mode: 5 }), { armed: true, flightMode: null });
});
test('freshness distinguishes stale and disconnected telemetry', () => {
  const value = parseTelemetryJson(contract, now);
  assert.equal(isTelemetryFresh(value, Date.parse(now) + 29_999), true);
  assert.equal(isTelemetryFresh(value, Date.parse(now) + 30_001), false);
  assert.equal(telemetryScreenState('connected', value, Date.parse(now) + 31_000), 'stale');
  assert.equal(telemetryScreenState('unconfigured'), 'unconfigured');
});
test('provider validates optional URL, fetches /telemetry, persists and stops polling', async () => {
  const store = memoryStore(); const repo = new DroneRepository(store); let requested;
  const provider = new LocalWifiDroneProvider(repo, store, async (url) => { requested = url; return new Response(JSON.stringify(contract), { status: 200 }); });
  await assert.rejects(() => provider.configureBaseUrl('bad address'), /valid local/i);
  assert.equal(await provider.configureBaseUrl('http://192.168.4.1/'), 'http://192.168.4.1');
  await provider.start();
  assert.equal(requested, 'http://192.168.4.1/telemetry'); assert.equal(provider.getStatus().status, 'connected');
  assert.equal((await repo.listTelemetry()).length, 1); provider.stop();
});
test('HTTP failure and timeout do not retain a live snapshot', async () => {
  const store = memoryStore(); const provider = new LocalWifiDroneProvider(new DroneRepository(store), store, async () => new Response('offline', { status: 503 }));
  await provider.configureBaseUrl('http://127.0.0.1'); await provider.start();
  assert.equal(provider.getStatus().status, 'error'); assert.equal(provider.getStatus().telemetry, undefined); provider.stop();
});
test('real armed telemetry starts a session, stores only valid GPS track points, and closes on disarm', async () => {
  const store = memoryStore(); const repo = new DroneRepository(store);
  const armed = parseTelemetryJson(contract, now); await repo.recordTelemetry(armed);
  const session = await repo.getActiveSession(); assert.equal(session.status, 'active'); assert.equal(session.telemetryCount, 1);
  assert.equal((await repo.getTrack(session.id)).length, 1);
  await repo.recordTelemetry(parseTelemetryJson({ ...contract, armed: false, latitude: null, longitude: null }, '2026-09-26T10:00:02.000Z'));
  const ended = (await repo.listSessions())[0]; assert.equal(ended.status, 'completed'); assert.equal(ended.observationCount, 0);
  assert.equal((await repo.getTrack(session.id)).length, 1);
});
test('observations increment only a matching active session', async () => {
  const store = memoryStore(); const repo = new DroneRepository(store); await repo.recordTelemetry(parseTelemetryJson(contract, now));
  const active = await repo.getActiveSession(); assert.equal(await repo.associateObservation(active.id, 'other-drone'), false);
  assert.equal(await repo.associateObservation(active.id, active.droneId), true);
  assert.equal((await repo.getActiveSession()).observationCount, 1);
});
