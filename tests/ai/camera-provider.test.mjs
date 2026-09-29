import assert from 'node:assert/strict';
import test from 'node:test';

import { LocalEsp32CameraProvider, parseCameraStatus } from '../../src/features/ai/camera-provider.ts';

const status = {
  status: 'ok', camera_initialized: true, device_id: 'PRITHVI-CAM-AA:BB:CC:DD:EE:FF',
  camera: 'ESP32-CAM', sensor: 'GC2145', sensor_pid: '0x2145', format: 'RGB565',
  width: 240, height: 240, wifi: { connected: true, ip: '192.168.1.42' },
};
const store = () => ({ async get() { return { id: 'esp32-cam', baseUrl: 'http://192.168.1.42' }; }, async save(_type, value) { return value; } });

test('parses actual camera status fields and rejects incomplete responses', () => {
  assert.equal(parseCameraStatus(status).sensorPid, '0x2145');
  assert.equal(parseCameraStatus({ ...status, width: '240' }), undefined);
  assert.equal(parseCameraStatus({ ...status, wifi: undefined }), undefined);
});

test('camera status endpoint accepts the firmware response shape', async () => {
  const provider = new LocalEsp32CameraProvider(store(), async () => new Response(JSON.stringify(status), { status: 200 }));
  const result = await provider.checkStatus();
  assert.equal(result.connected, true);
  assert.equal(result.camera.format, 'RGB565');
});

test('malformed camera status JSON is reported as disconnected', async () => {
  const provider = new LocalEsp32CameraProvider(store(), async () => new Response('{bad', { status: 200 }));
  const result = await provider.checkStatus();
  assert.equal(result.connected, false);
  assert.equal(provider.getState(), 'unreachable');
});

test('HTTP capture failure is surfaced without creating an image result', async () => {
  const provider = new LocalEsp32CameraProvider(store(), async () => new Response('camera failed', { status: 500 }));
  await assert.rejects(() => provider.capture(), /HTTP 500/);
  assert.equal(provider.getState(), 'unreachable');
});

test('camera URL validation occurs before saving configuration', async () => {
  const saved = [];
  const configStore = { ...store(), async save(_type, value) { saved.push(value); return value; } };
  const provider = new LocalEsp32CameraProvider(configStore);
  await assert.rejects(() => provider.configureBaseUrl('not a URL'), /valid local/i);
  assert.equal(saved.length, 0);
});

test('camera capture timeout is reported cleanly', async () => {
  const provider = new LocalEsp32CameraProvider(store(), (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }), 5);
  await assert.rejects(() => provider.capture(), /timed out/i);
});
