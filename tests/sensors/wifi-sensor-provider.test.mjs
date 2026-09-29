import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEsp32SensorPayload } from '../../src/features/sensors/protocol/esp32-jsonl.ts';
import { normalizeBaseUrl, WifiSensorProvider } from '../../src/features/sensors/wifi-sensor-provider.ts';

const validPayload = { device_id: 'PRITHVI-ESP32-01', temperature: 27.6, humidity: 43.4, soil_raw: 4095, rain_raw: 95, uptime_ms: 38716 };
function harness(fetcher, overrides = {}) {
  const frames = [];
  const config = { async get() { return { id: 'esp32-wifi', baseUrl: 'http://192.168.1.50' }; }, async save(_type, value) { return value; } };
  const repository = {
    async saveFrame(...frame) { frames.push(frame); }, async listNodes() { return []; }, async listSensors() { return []; },
    async latestReadings() { return []; }, async history() { return []; }, async listHealth() { return []; },
  };
  const withHealth = async (url, options) => url.endsWith('/health') ? response({ device_id: validPayload.device_id, status: 'ok' }) : fetcher(url, options);
  const provider = new WifiSensorProvider(repository, config, { fetcher: withHealth, pollIntervalMs: 2_000, timeoutMs: 100, now: () => new Date('2026-09-24T10:00:00.000Z'), ...overrides });
  return { provider, frames };
}
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
const eventually = async (predicate, timeoutMs = 500) => {
  const stopAt = Date.now() + timeoutMs;
  while (Date.now() < stopAt) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 2)); }
  assert.fail('condition was not reached in time');
};

test('validates REST response fields and retains a null DHT value as unavailable', () => {
  const parsed = parseEsp32SensorPayload({ ...validPayload, temperature: null });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.frame.temperatureC, null);
  assert.equal(parsed.frame.fieldQuality.temperature.valid, false);
  assert.equal(parsed.frame.soilRaw, 4095);
  assert.equal(parsed.frame.deviceTimestamp, 38716);
  const partial = parseEsp32SensorPayload({ device_id: validPayload.device_id, temperature: 25 });
  assert.equal(partial.frame.fieldQuality.humidity.valid, false);
  assert.equal(partial.frame.fieldQuality.rain.valid, false);
  assert.deepEqual(parseEsp32SensorPayload('{bad'), { ok: false, reason: 'invalid_payload' });
  assert.equal(parseEsp32SensorPayload({ ...validPayload, humidity: 101 }).frame.fieldQuality.humidity.valid, false);
  assert.equal(parseEsp32SensorPayload({ temperature: 20 }).ok, false);
});

test('polls the HTTP endpoint and persists app receive time separately from device uptime', async () => {
  const { provider, frames } = harness(async (url) => { assert.equal(url, 'http://192.168.1.50/sensors'); return response(validPayload); });
  await provider.start();
  await eventually(() => frames.length === 1);
  assert.equal(provider.getConnection().status, 'connected');
  assert.equal(provider.getConnection().deviceId, validPayload.device_id);
  assert.equal(frames[0][1], '2026-09-24T10:00:00.000Z');
  assert.equal(frames[0][3], 38716);
  assert.equal(frames[0][4], 'device_wifi');
  assert.equal(frames[0][2].temperature.value, 27.6);
  assert.equal(frames[0][2].humidity.value, 43.4);
  assert.equal(frames[0][2].soil_moisture.value, 4095);
  assert.equal(frames[0][2].rain.value, 95);
  await provider.stop();
});

test('reports malformed JSON and HTTP failures without throwing', async () => {
  const malformed = harness(async () => ({ ok: true, status: 200, async json() { throw new Error('bad json'); } }));
  await malformed.provider.start();
  await eventually(() => malformed.provider.getConnection().status === 'error');
  await malformed.provider.stop();

  const httpError = harness(async () => response({}, 503));
  await httpError.provider.start();
  await eventually(() => httpError.provider.getConnection().detail.includes('HTTP 503'));
  await httpError.provider.stop();
});

test('marks an unreachable or timed-out ESP32 disconnected', async () => {
  const unreachable = harness(async () => { throw new TypeError('Network request failed'); });
  await unreachable.provider.start();
  await eventually(() => unreachable.provider.getConnection().status === 'disconnected');
  await unreachable.provider.stop();

  const timeout = harness((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), { timeoutMs: 5 });
  await timeout.provider.start();
  await eventually(() => timeout.provider.getConnection().detail.includes('timed out'));
  await timeout.provider.stop();
});

test('changes recently received readings to stale when no newer response arrives', async () => {
  let now = new Date('2026-09-24T10:00:00.000Z');
  let calls = 0;
  let sensorCalls = 0;
  const config = { async get() { return { id: 'esp32-wifi', baseUrl: 'http://192.168.1.50' }; }, async save(_type, value) { return value; } };
  const repository = { async saveFrame() {}, async listNodes() { return []; }, async listSensors() { return []; }, async latestReadings() { return []; }, async history() { return []; }, async listHealth() { return []; } };
  const provider = new WifiSensorProvider(repository, config, { fetcher: async (url, { signal }) => { calls += 1; if (url.endsWith('/health')) return response({ device_id: validPayload.device_id, status: 'ok' }); sensorCalls += 1; if (sensorCalls === 1) return response(validPayload); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); }, pollIntervalMs: 15, timeoutMs: 2_000, now: () => now });
  await provider.start();
  try {
    await eventually(() => sensorCalls === 1);
    await eventually(() => provider.getConnection().status === 'connected');
    assert.equal(provider.getConnection().status, 'connected', JSON.stringify({ connection: provider.getConnection(), calls, sensorCalls }));
    now = new Date('2026-09-24T10:00:15.000Z');
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(provider.getConnection().status, 'stale', JSON.stringify({ connection: provider.getConnection(), calls, sensorCalls, now: now.toISOString() }));
  } finally { await provider.stop(); }
});

test('normalizes and validates an HTTP base URL without requiring a fixed IP', () => {
  assert.equal(normalizeBaseUrl('  http://192.168.4.10/  '), 'http://192.168.4.10');
  assert.equal(normalizeBaseUrl('http://esp32.local:8080'), 'http://esp32.local:8080');
  assert.throws(() => normalizeBaseUrl('https://192.168.4.10'), /local HTTP address/);
  assert.throws(() => normalizeBaseUrl('http://192.168.4.10/sensors'), /local HTTP address/);
});

test('saves the configured address locally through its configuration store', async () => {
  let stored;
  const config = { async get() { return stored; }, async save(_type, value) { stored = value; return value; } };
  const repository = { async saveFrame() {}, async listNodes() { return []; }, async listSensors() { return []; }, async latestReadings() { return []; }, async history() { return []; }, async listHealth() { return []; } };
  const provider = new WifiSensorProvider(repository, config);
  await provider.configureBaseUrl('http://192.168.4.1/');
  assert.equal(stored.baseUrl, 'http://192.168.4.1');
  assert.equal(await provider.getConfiguredBaseUrl(), 'http://192.168.4.1');
});

test('checks the ESP32 /health endpoint without creating sensor readings', async () => {
  let requested;
  const { provider, frames } = harness(async () => response(validPayload), { fetcher: async (url) => { requested = url; return response({ device_id: validPayload.device_id, status: 'ok' }); } });
  const status = await provider.checkEndpointHealth();
  assert.equal(requested, 'http://192.168.1.50/health');
  assert.equal(status.available, true);
  assert.equal(frames.length, 0);
});

test('does not poll readings when the ESP32 /health endpoint fails', async () => {
  let sensorRequested = false;
  const { provider } = harness(async (url) => { if (url.endsWith('/health')) return response({}, 503); sensorRequested = true; return response(validPayload); }, { fetcher: async (url) => { if (url.endsWith('/health')) return response({}, 503); sensorRequested = true; return response(validPayload); } });
  await provider.start();
  assert.equal(provider.getConnection().status, 'disconnected');
  assert.match(provider.getConnection().detail, /HTTP 503/);
  assert.equal(sensorRequested, false);
  await provider.stop();
});

test('stopping the provider aborts an in-flight poll and ignores its late result', async () => {
  let saved = false;
  const config = { async get() { return { id: 'esp32-wifi', baseUrl: 'http://192.168.1.50' }; }, async save(_type, value) { return value; } };
  const repository = { async saveFrame() { saved = true; }, async listNodes() { return []; }, async listSensors() { return []; }, async latestReadings() { return []; }, async history() { return []; }, async listHealth() { return []; } };
  const provider = new WifiSensorProvider(repository, config, { fetcher: (_url, { signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve(response(validPayload)), { once: true })), timeoutMs: 2_000 });
  await provider.start();
  await provider.stop();
  assert.equal(saved, false);
  assert.equal(provider.getConnection().status, 'disconnected');
});
