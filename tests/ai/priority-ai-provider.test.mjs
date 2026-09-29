import assert from 'node:assert/strict';
import test from 'node:test';

import { AIServiceError, OnDeviceAIUnavailableError } from '../../src/features/ai/ai-types.ts';
import { PriorityAIProvider } from '../../src/features/ai/priority-ai-provider.ts';

const result = { status: 'possible_issue', crop: 'Potato', condition: 'Late blight', rawLabel: 'Potato___Late_blight', confidence: 0.84, observation: 'Possible crop-health issue', modelVersion: 'test-model', source: 'esp32_cam_rgb', imageQuality: { status: 'acceptable', reason: null }, timestamp: '2026-01-01T00:00:00Z', provider: 'on_device_ai', inferenceValidated: true };
function makeStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { async get(_type, id) { return values.get(id); }, async save(_type, value) { values.set(value.id, value); return value; } };
}

test('on-device provider is primary and server is not checked or called during inference', async () => {
  let serverCalls = 0;
  const provider = new PriorityAIProvider({ async getStatus() { return { status: 'ready', detail: 'Loaded on device' }; }, async analyzeImage() { return result; } }, { async checkHealth() { serverCalls += 1; return { available: false, modelAvailable: false }; }, async analyzeImage() { serverCalls += 1; throw new Error('server down'); }, async getConfiguredBaseUrl() { return 'http://127.0.0.1:8000'; }, async configureBaseUrl(value) { return value; } }, makeStore());
  assert.equal((await provider.checkHealth()).available, true);
  assert.equal((await provider.analyzeImage('local://image.jpg', {})).provider, 'on_device_ai');
  assert.equal(serverCalls, 0);
});

test('server failure does not block an on-device model result', async () => {
  const provider = new PriorityAIProvider({ async getStatus() { return { status: 'ready', detail: 'ready' }; }, async analyzeImage() { return result; } }, { async checkHealth() { throw new Error('must not run'); }, async analyzeImage() { throw new AIServiceError('server offline'); }, async getConfiguredBaseUrl() {}, async configureBaseUrl(value) { return value; } }, makeStore({ 'provider-priority': { id: 'provider-priority', allowOptionalServerFallback: true } }));
  assert.equal((await provider.analyzeImage('local://image.jpg', {})).status, 'possible_issue');
});

test('optional server fallback is disabled by default and requires explicit opt-in', async () => {
  let serverCalls = 0;
  const onDevice = { async getStatus() { return { status: 'unavailable', detail: 'Model unavailable' }; }, async analyzeImage() { throw new OnDeviceAIUnavailableError('Model unavailable'); } };
  const server = { async checkHealth() { serverCalls += 1; return { available: true, modelAvailable: true }; }, async analyzeImage() { serverCalls += 1; return { ...result, provider: 'optional_local_server' }; }, async getConfiguredBaseUrl() {}, async configureBaseUrl(value) { return value; } };
  const provider = new PriorityAIProvider(onDevice, server, makeStore());
  await assert.rejects(() => provider.analyzeImage('local://image.jpg', {}), /model unavailable/i);
  assert.equal(serverCalls, 0);
  await provider.setOptionalServerFallbackEnabled(true);
  assert.equal((await provider.analyzeImage('local://image.jpg', {})).provider, 'optional_local_server');
  assert.equal(serverCalls, 1);
});

test('local server being unavailable does not replace the visible on-device failure', async () => {
  const provider = new PriorityAIProvider({ async getStatus() { return { status: 'unavailable', detail: 'Native development build required' }; }, async analyzeImage() { throw new OnDeviceAIUnavailableError('Native development build required'); } }, { async checkHealth() { return { available: false, modelAvailable: false }; }, async analyzeImage() { throw new Error('server unavailable'); }, async getConfiguredBaseUrl() {}, async configureBaseUrl(value) { return value; } }, makeStore({ 'provider-priority': { id: 'provider-priority', allowOptionalServerFallback: true } }));
  await assert.rejects(() => provider.analyzeImage('local://image.jpg', {}), /native development build required/i);
});
