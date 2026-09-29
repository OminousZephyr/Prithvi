import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { NetlifyKisanMitraProvider, validateKisanEndpoint, validateKisanResponse } from '../../src/features/kisanmitra/kisanmitra-provider.ts';
import { buildKisanContext } from '../../src/features/kisanmitra/kisanmitra-context.ts';
import { handleKisanMitraRequest } from '../../netlify/functions/kisanmitra.mjs';
import { translate } from '../../src/localization/resources.ts';

const context = { language: 'en', recentObservations: [], scoutingEvidence: [], activeAdvisories: [], activeAlerts: [], sensorReadings: [], recentCropPrices: [] };
const schema = { answer: 'Based on the saved records, no new observation is available.', actions: [], sources: [], confidence: 'low', needs_verification: true };

test('provider sends structured context and validates a controlled response', async () => {
  let body; const provider = new NetlifyKisanMitraProvider('https://farm.example/.netlify/functions/kisanmitra', async (_url, init) => { body = JSON.parse(init.body); return new Response(JSON.stringify(schema), { status: 200 }); });
  const result = await provider.ask('What needs my attention?', context); assert.equal(body.question, 'What needs my attention?'); assert.deepEqual(body.context, context); assert.equal(result.needs_verification, true);
});

test('malformed response and invalid endpoint fail safely', async () => {
  assert.throws(() => validateKisanResponse({ answer: 'x' }), /invalid response/i);
  assert.throws(() => validateKisanEndpoint('javascript:alert(1)'), /URL/i);
  assert.throws(() => validateKisanEndpoint('https://user:secret@example.com'), /URL/i);
});

test('offline request fails without requiring or calling any AI server for the on-device path', async () => {
  let called = false; const provider = new NetlifyKisanMitraProvider(undefined, async () => { called = true; throw new Error('offline'); });
  await assert.rejects(() => provider.ask('question', context), /not configured/i); assert.equal(called, false);
  assert.match(translate('en', 'kisanmitraOffline'), /internet connection/i); assert.match(translate('hi', 'kisanmitraOffline'), /ऑफ़लाइन/);
});

test('context contains only selected-farm data and does not invent prices or readings', async () => {
  const fields = [{ id: 'field-1', farmId: 'farm-1', name: 'North', crop: { name: 'Tomato' } }, { id: 'field-2', farmId: 'farm-2', name: 'Other', crop: { name: 'Rice' } }];
  const result = await buildKisanContext({ listFarms: async () => [{ id: 'farm-1', name: 'Local farm' }], listFields: async () => fields, getFarm: async () => undefined, listObservations: async () => [{ id: 'obs-1', fieldId: 'field-1', observedAt: '2026-09-29T00:00:00Z', source: 'manual_photo' }], listEvidence: async () => [], listAdvisories: async () => [], listAlerts: async () => [], listSensors: async () => [], listNodes: async () => [], latestReadings: async () => [] }, 'field-1', 'en');
  assert.equal(result.field.crop, 'Tomato'); assert.equal(result.recentCropPrices.length, 0); assert.equal(result.sensorReadings.length, 0); assert.equal(result.recentObservations.length, 1);
});

test('Netlify function returns controlled JSON and never returns its Gemini key', async () => {
  const response = await handleKisanMitraRequest(new Request('https://site.test/.netlify/functions/kisanmitra', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'Explain records', context }) }), {
    env: { GEMINI_API_KEY: 'server-only-secret' },
    fetcher: async (_url, init) => { assert.equal(init.headers['x-goog-api-key'], 'server-only-secret'); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(schema) }] } }] }), { status: 200 }); },
  });
  const text = await response.text(); assert.equal(response.status, 200); assert.doesNotMatch(text, /server-only-secret/); assert.equal(JSON.parse(text).needs_verification, true);
});

test('function handles missing key, malformed model output, and secret stays server-side', async () => {
  const request = () => new Request('https://site.test/kisan', { method: 'POST', body: JSON.stringify({ question: 'Q', context }) });
  assert.equal((await handleKisanMitraRequest(request(), { env: {} })).status, 503);
  const invalid = await handleKisanMitraRequest(request(), { env: { GEMINI_API_KEY: 'x' }, fetcher: async () => new Response('{bad json', { status: 200 }) }); assert.equal(invalid.status, 502);
  const source = fs.readFileSync('src/features/kisanmitra/kisanmitra-provider.ts', 'utf8'); assert.doesNotMatch(source, /GEMINI_API_KEY|service.role/i);
});

test('function rejects unsafe chemical-treatment guidance instead of returning it', async () => {
  const unsafe = { ...schema, answer: 'Spray fungicide on the crop now.' };
  const response = await handleKisanMitraRequest(new Request('https://site.test/kisan', { method: 'POST', body: JSON.stringify({ question: 'What should I do?', context }) }), { env: { GEMINI_API_KEY: 'server-only' }, fetcher: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(unsafe) }] } }] }), { status: 200 }) });
  assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /fungicide|server-only/i);
});
