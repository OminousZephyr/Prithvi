import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAdvisoryContext } from '../../src/features/advisory/advisory-engine.ts';
import { AdvisoryRepository } from '../../src/features/advisory/advisory-repository.ts';

const now = '2026-09-29T12:00:00.000Z';
const field = { id: 'field-a', farmId: 'farm-a', name: 'North field', crop: { id: 'tomato', name: 'Tomato', growthStage: 'flowering' }, irrigationMethod: 'drip', sensorNodeIds: [], observationIds: [], healthStatus: 'unassessed', createdAt: now, syncState: 'local' };
function observation(id, changes = {}) { return { id, fieldId: 'field-a', farmId: 'farm-a', title: 'Possible crop-health issue', kind: 'crop_health', source: 'esp32_cam_rgb', timestamp: now, observedAt: now, scanStatus: 'possible_issue', imageQuality: 'acceptable', crop: 'Tomato', condition: 'Early blight', confidence: 0.84, verificationStatus: 'requires_verification', provenance: ['on_device_ai'], evidence: [], syncState: 'local', ...changes }; }
function reading(id, changes = {}) { return { id, sensorId: 'soil-sensor', deviceId: 'esp32-1', value: 1750, unit: 'ADC count', observedAt: now, receivedAt: now, source: 'device_wifi', quality: 'valid', syncState: 'local', ...changes }; }
function memoryStore(initial = {}) {
  const rows = new Map(Object.entries(initial).flatMap(([type, records]) => records.map((item) => [`${type}:${item.id}`, item])));
  return { rows, async list(type) { return [...rows].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async get(type, id) { return rows.get(`${type}:${id}`); }, async save(type, value) { rows.set(`${type}:${value.id}`, value); return value; } };
}
const context = (overrides = {}) => ({ fieldId: 'field-a', farmId: 'farm-a', crop: 'Tomato', growthStage: 'flowering', observations: [], evidence: [], sensorReadings: [], now, ...overrides });

test('single possible issue makes a medium inspection advisory with evidence references', () => {
  const result = evaluateAdvisoryContext(context({ observations: [observation('obs-1')] }));
  assert.equal(result.advisories[0].title, 'Inspect affected area');
  assert.equal(result.advisories[0].priority, 'medium');
  assert.deepEqual(result.advisories[0].sourceObservationIds, ['obs-1']);
  assert.match(result.advisories[0].reason, /84%/);
  assert.equal(result.riskSignals[0].type, 'possible_crop_health_issue');
});

test('repeated evidence creates a zone inspection suggestion without changing confidence', () => {
  const evidence = { id: 'ev-1', fieldId: 'field-a', zoneId: 'zone-north', observationIds: ['o1', 'o2'], observationCount: 2, firstObservedAt: now, lastObservedAt: now, center: { latitude: 12, longitude: 76 }, crop: 'Tomato', condition: 'Tomato___Early_blight', confidenceRange: { min: 0.71, max: 0.86 }, status: 'inspection_suggested', evidenceLevel: 'repeated_observation', createdAt: now, updatedAt: now, syncState: 'local' };
  const result = evaluateAdvisoryContext(context({ observations: [observation('o1'), observation('o2', { confidence: 0.86 })], evidence: [evidence] }));
  const repeat = result.advisories.find((item) => item.category === 'scouting');
  assert.equal(repeat.title, 'Inspect this zone');
  assert.deepEqual(repeat.sourceObservationIds, ['o1', 'o2']);
  assert.deepEqual(repeat.sourceEvidenceIds, ['ev-1']);
  assert.equal(repeat.priority, 'medium');
});

test('low confidence and poor image quality produce separate low-priority guidance', () => {
  const result = evaluateAdvisoryContext(context({ observations: [observation('low', { scanStatus: 'uncertain', confidence: 0.4 }), observation('blurry', { imageQuality: 'low' })] }));
  assert.equal(result.advisories.length, 2);
  assert.equal(result.advisories.find((item) => item.ruleId === 'low-confidence-screening').action, 'Capture a clearer image or rescan the area.');
  assert.equal(result.advisories.find((item) => item.category === 'image_quality').priority, 'low');
});

test('stale sensor advice is informational and never uses stale values for a threshold rule', () => {
  const stale = reading('old', { receivedAt: '2026-09-29T10:00:00.000Z', value: 1 });
  const result = evaluateAdvisoryContext(context({ sensorReadings: [stale], sensors: [{ id: 'soil-sensor', nodeId: 'node-a', kind: 'soil_moisture', label: 'Soil', unit: 'ADC count' }], rule: { id: 'rule-a', fieldId: 'field-a', enabled: true, irrigationCheckEnabled: true, soilRawBelow: 1000, updatedAt: now } }));
  assert.equal(result.advisories.length, 1);
  assert.equal(result.advisories[0].title, 'Sensor reading is outdated');
  assert.deepEqual(result.advisories[0].sourceSensorReadingIds, ['old']);
  assert.equal(result.riskSignals[0].type, 'stale_sensor_data');
});

test('soil raw guidance requires a current valid value and an explicit field rule; it preserves ADC units', () => {
  const sensors = [{ id: 'soil-sensor', nodeId: 'node-a', kind: 'soil_moisture', label: 'Soil', unit: 'ADC count' }];
  const rule = { id: 'rule-a', fieldId: 'field-a', crop: 'Tomato', enabled: true, irrigationCheckEnabled: true, soilRawBelow: 1800, updatedAt: now };
  const valid = evaluateAdvisoryContext(context({ sensorReadings: [reading('soil')], sensors, rule }));
  assert.equal(valid.advisories[0].title, 'Check soil moisture before irrigation');
  assert.match(valid.advisories[0].message, /1750 ADC counts/);
  assert.match(valid.advisories[0].reason, /not percentages/);
  assert.equal(valid.advisories[0].priority, 'low');
  assert.equal(evaluateAdvisoryContext(context({ sensorReadings: [reading('bad', { quality: 'invalid' })], sensors, rule })).advisories.length, 0);
  assert.equal(evaluateAdvisoryContext(context({ sensorReadings: [reading('missing', { value: undefined })], sensors, rule })).advisories.length, 0);
  assert.equal(evaluateAdvisoryContext(context({ sensorReadings: [reading('unconfigured')], sensors })).advisories.length, 0);
});

test('humidity, temperature and rain rules only emit from explicit configured references', () => {
  const sensors = [
    { id: 'humidity', nodeId: 'node-a', kind: 'humidity', label: 'Humidity', unit: '% RH' },
    { id: 'temperature', nodeId: 'node-a', kind: 'temperature', label: 'Temperature', unit: '°C' },
    { id: 'rain', nodeId: 'node-a', kind: 'rain', label: 'Rain raw', unit: 'ADC count' },
  ];
  const readings = [reading('h', { sensorId: 'humidity', value: 80, unit: '% RH' }), reading('t', { sensorId: 'temperature', value: 37, unit: '°C' }), reading('r', { sensorId: 'rain', value: 95 })];
  assert.equal(evaluateAdvisoryContext(context({ sensors, sensorReadings: readings })).advisories.length, 0);
  const configured = evaluateAdvisoryContext(context({ sensors, sensorReadings: readings, rule: { id: 'r', fieldId: 'field-a', enabled: true, humidityAbovePct: 70, temperatureAboveC: 35, rainRawThreshold: 100, rainRawActiveWhen: 'below', updatedAt: now } }));
  assert.equal(configured.advisories.length, 3);
  assert.match(configured.advisories.find((item) => item.ruleId === 'configured-rain-raw-reference').message, /not a rainfall amount/);
});

test('verification stays separate from AI and dismissed observations do not create inspection advice', () => {
  const checked = observation('checked', { verificationStatus: 'verified' });
  const reviewed = evaluateAdvisoryContext(context({ observations: [checked] })).advisories[0];
  assert.equal(reviewed.category, 'monitoring'); assert.equal(reviewed.verificationState, 'verified');
  assert.equal(evaluateAdvisoryContext(context({ observations: [observation('dismissed', { verificationStatus: 'dismissed' })] })).advisories.length, 0);
});

test('multiple evidence zones create separate advisory records and preserve each observation reference', () => {
  const observations = ['a1', 'a2', 'b1', 'b2'].map((id) => observation(id));
  const evidence = [
    { id: 'e-a', fieldId: 'field-a', zoneId: 'zone-a', observationIds: ['a1', 'a2'], observationCount: 2, firstObservedAt: now, lastObservedAt: now, center: { latitude: 12, longitude: 76 }, crop: 'Tomato', condition: 'Tomato___Early_blight', confidenceRange: { min: 0.7, max: 0.8 }, status: 'inspection_suggested', evidenceLevel: 'repeated_observation', createdAt: now, updatedAt: now, syncState: 'local' },
    { id: 'e-b', fieldId: 'field-a', zoneId: 'zone-b', observationIds: ['b1', 'b2'], observationCount: 2, firstObservedAt: now, lastObservedAt: now, center: { latitude: 12.01, longitude: 76.01 }, crop: 'Tomato', condition: 'Tomato___Early_blight', confidenceRange: { min: 0.71, max: 0.81 }, status: 'inspection_suggested', evidenceLevel: 'repeated_observation', createdAt: now, updatedAt: now, syncState: 'local' },
  ];
  const result = evaluateAdvisoryContext(context({ observations, evidence }));
  const zoneAdvisories = result.advisories.filter((item) => item.category === 'scouting');
  assert.deepEqual(zoneAdvisories.map((item) => item.zoneId).sort(), ['zone-a', 'zone-b']);
  assert.deepEqual(zoneAdvisories.map((item) => item.sourceEvidenceIds[0]).sort(), ['e-a', 'e-b']);
});

test('repository deduplicates stable advisories, resolves on dismissal, retains history, and expires records', async () => {
  const db = memoryStore({ field: [field], farm: [{ id: 'farm-a', name: 'Farm', fieldIds: ['field-a'], createdAt: now, syncState: 'local' }], 'crop-observation': [observation('obs-1')] });
  const repo = new AdvisoryRepository(db);
  const first = await repo.refresh(now); const again = await repo.refresh(now);
  assert.equal(first.length, 1); assert.equal(again.length, 1); assert.equal((await db.list('advisory')).length, 1);
  await db.save('crop-observation', observation('obs-1', { verificationStatus: 'dismissed' }));
  const resolved = await repo.refresh(now);
  assert.equal(resolved[0].status, 'resolved'); assert.equal(resolved[0].verificationState, 'dismissed');

  const expiryDb = memoryStore({ field: [field], 'crop-observation': [observation('expiry', { confidence: 0.4, scanStatus: 'uncertain' })], 'advisory-rule': [{ id: 'rule', fieldId: 'field-a', enabled: true, validForMs: 1000, updatedAt: now }] });
  const expiryRepo = new AdvisoryRepository(expiryDb);
  const generated = (await expiryRepo.refresh(now))[0];
  assert.equal((await expiryRepo.refresh('2026-09-29T12:00:02.000Z')).find((item) => item.id === generated.id).status, 'expired');
});

test('SQLite-style offline repository scopes rules and advisories to distinct fields and keeps sensor links', async () => {
  const secondField = { ...field, id: 'field-b', farmId: 'farm-b', crop: { id: 'potato', name: 'Potato' } };
  const nodes = [{ id: 'node-a', fieldId: 'field-a', name: 'Node A', hardware: 'ESP32', status: 'online', sensorIds: ['soil-sensor'] }];
  const sensors = [{ id: 'soil-sensor', nodeId: 'node-a', kind: 'soil_moisture', label: 'Soil', unit: 'ADC count' }];
  const rule = { id: 'rule-a', fieldId: 'field-a', crop: 'Tomato', enabled: true, irrigationCheckEnabled: true, soilRawBelow: 1800, updatedAt: now };
  const db = memoryStore({ field: [field, secondField], farm: [{ id: 'farm-a', fieldIds: ['field-a'], name: 'A', createdAt: now, syncState: 'local' }, { id: 'farm-b', fieldIds: ['field-b'], name: 'B', createdAt: now, syncState: 'local' }], 'sensor-node': nodes, sensor: sensors, 'sensor-reading': [reading('soil')], 'advisory-rule': [rule], 'crop-observation': [observation('one'), observation('two', { fieldId: 'field-b', farmId: 'farm-b', crop: 'Potato' })] });
  const repo = new AdvisoryRepository(db); const records = await repo.refresh(now);
  assert.ok(records.some((item) => item.fieldId === 'field-a' && item.category === 'irrigation_check'));
  assert.ok(records.some((item) => item.fieldId === 'field-b' && item.category === 'inspection'));
  assert.deepEqual(records.find((item) => item.category === 'irrigation_check').sourceSensorReadingIds, ['soil']);
  assert.equal((await db.list('risk-signal')).length >= 2, true);
});

test('low-quality camera result can be persisted as guidance without becoming an observation', async () => {
  const db = memoryStore(); const repo = new AdvisoryRepository(db);
  const advisory = await repo.recordLowImageQuality({ fieldId: 'field-a', capturedAt: now, source: 'esp32_cam_rgb', imageReference: 'http://camera/capture' });
  assert.equal(advisory.category, 'image_quality'); assert.deepEqual(advisory.sourceObservationIds, []);
  assert.equal((await db.list('crop-observation')).length, 0);
  assert.equal((await db.list('risk-signal'))[0].type, 'low_image_quality');
});
