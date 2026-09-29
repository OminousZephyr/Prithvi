import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLocalServiceUrl } from '../../src/features/ai/local-service-config.ts';
import { LocalAIProvider, parseAIAnalysisResult } from '../../src/features/ai/local-ai-provider.ts';
import { AIRepository } from '../../src/features/ai/ai-repository.ts';

const valid = { status: 'unavailable', reason: 'No trained model installed', crop: 'unknown', condition: 'unknown', confidence: null, observation: null, model_version: null, source: 'esp32_cam_rgb', image_quality: { status: 'acceptable', reason: null }, timestamp: '2026-09-25T00:00:00Z' };
const store = () => ({ values: new Map(), async get(_type, id) { return this.values.get(id); }, async save(_type, item) { this.values.set(item.id, item); return item; } });

test('accepts a valid explicit no-model response', () => assert.equal(parseAIAnalysisResult(valid).reason, 'No trained model installed'));
test('accepts a structurally valid model response without inventing one in production', () => {
  const result = parseAIAnalysisResult({ ...valid, status: 'possible_issue', reason: null, crop: 'unknown', condition: 'unknown', confidence: 0.81, observation: 'Possible visible crop-health anomaly', model_version: 'test-model-v1' });
  assert.equal(result.confidence, 0.81);
  assert.equal(result.status, 'possible_issue');
});
test('posts an image and parses a successful real-service response', async () => {
  let requestedUrl;
  const provider = new LocalAIProvider(store(), async (url, options) => {
    requestedUrl = url;
    assert.equal(options.method, 'POST');
    assert.ok(options.body instanceof FormData);
    assert.ok(options.body.get('file') instanceof Blob);
    return new Response(JSON.stringify({ ...valid, status: 'healthy_looking', reason: null, confidence: 0.76, observation: 'Healthy-looking crop', model_version: 'reviewed-v1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  await provider.configureBaseUrl('http://192.168.1.20:8000');
  const result = await provider.analyzeImage('data:image/jpeg;base64,AA==', { fieldId: 'field-1', imageBlob: new Blob(['jpeg']) });
  assert.equal(requestedUrl, 'http://192.168.1.20:8000/analyze');
  assert.equal(result.status, 'healthy_looking');
  assert.equal(result.modelVersion, 'reviewed-v1');
});
test('handles an unavailable model response with a low-quality image', () => assert.equal(parseAIAnalysisResult({ ...valid, reason: 'Image quality too low', image_quality: { status: 'low', reason: 'Image too small.' } }).imageQuality.status, 'low'));
test('rejects malformed responses and out-of-range confidence values', () => {
  assert.throws(() => parseAIAnalysisResult('{bad'), /invalid shape/i);
  assert.throws(() => parseAIAnalysisResult({ ...valid, status: 'possible_issue', confidence: 2, model_version: 'v1', observation: 'possible issue' }), /confidence/i);
});
test('preserves low confidence as low instead of upgrading an observation', () => {
  const result = parseAIAnalysisResult({ ...valid, status: 'possible_issue', confidence: 0.12, model_version: 'reviewed-v1', observation: 'Possible visible crop-health anomaly' });
  assert.equal(result.confidence, 0.12);
  assert.equal(result.status, 'possible_issue');
});
test('normalizes address and rejects invalid endpoint base URLs', () => {
  assert.equal(normalizeLocalServiceUrl(' http://192.168.1.9:8000/ '), 'http://192.168.1.9:8000');
  assert.throws(() => normalizeLocalServiceUrl('not a URL'), /valid local/i);
  assert.throws(() => normalizeLocalServiceUrl('https://example.com/analyze'), /without a path/i);
});
test('reports HTTP error and request timeout distinctly', async () => {
  const responseProvider = new LocalAIProvider(store(), async () => new Response('no', { status: 503 }), 50);
  await responseProvider.configureBaseUrl('http://127.0.0.1:8000');
  await assert.rejects(() => responseProvider.analyzeImage('data:image/jpeg;base64,AA==', { imageBlob: new Blob(['x']) }), /HTTP 503/);

  const timeoutProvider = new LocalAIProvider(store(), (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))), 10);
  await timeoutProvider.configureBaseUrl('http://127.0.0.1:8000');
  await assert.rejects(() => timeoutProvider.analyzeImage('data:image/jpeg;base64,AA==', { imageBlob: new Blob(['x']) }), /timed out/i);
});
test('malformed JSON from the service is reported', async () => {
  const provider = new LocalAIProvider(store(), async () => new Response('{bad', { status: 200, headers: { 'content-type': 'application/json' } }));
  await provider.configureBaseUrl('http://127.0.0.1:8000');
  await assert.rejects(() => provider.analyzeImage('data:image/jpeg;base64,AA==', { imageBlob: new Blob(['x']) }), /malformed JSON/i);
});
test('persists only a real actionable model observation with provenance', async () => {
  const records = new Map();
  const repository = new AIRepository({ async list() { return [...records.values()]; }, async save(_type, item) { records.set(item.id, item); return item; } });
  const result = { ...parseAIAnalysisResult({ ...valid, status: 'possible_issue', confidence: 0.81, observation: 'Possible visible crop-health anomaly', model_version: 'reviewed-v1' }), provider: 'on_device_ai', rawLabel: 'Potato___Late_blight', inferenceValidated: true, provenance: ['on_device_ai'] };
  const saved = await repository.saveScan(result, { fieldId: 'field-1', capturedAt: result.timestamp }, 'data:image/jpeg;base64,AA==');
  assert.equal(saved.fieldId, 'field-1');
  assert.equal(saved.source, 'esp32_cam_rgb');
  assert.equal(saved.verificationStatus, 'requires_verification');
  assert.equal(await repository.saveScan(parseAIAnalysisResult(valid), {}, 'image'), undefined);
  assert.equal(records.size, 1);
});
