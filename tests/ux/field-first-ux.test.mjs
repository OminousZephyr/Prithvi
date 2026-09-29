import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildSensorGrid } from '../../src/features/sensors/presentation/sensor-presentation.ts';
import { buildSensorAlerts, interpretSensorValue, SENSOR_STARTER_CALIBRATION } from '../../src/features/sensors/presentation/sensor-interpretation.ts';
import { translate } from '../../src/localization/resources.ts';

const root = new URL('../../', import.meta.url);

test('farmer field creation does not require or name a Farm', async () => {
  const source = await readFile(new URL('src/app/(tabs)/fields.tsx', root), 'utf8');
  assert.match(source, /fieldAddTitle/);
  assert.match(source, /fieldNameLabel/);
  assert.doesNotMatch(source, /Add farm|Create farm|farm before/i);
  assert.match(source, /internal farm association/i);
});

test('Farm and Field records remain backward compatible and do not require optional setup data', async () => {
  const models = await readFile(new URL('src/domain/models/index.ts', root), 'utf8');
  assert.match(models, /interface Farm .*fieldIds: string\[\]/);
  assert.match(models, /interface Field .*farmId: string/);
  assert.match(models, /interface Field .*boundary\?: FieldBoundary/);
  assert.match(models, /interface Field .*sensorNodeIds: string\[\]/);
});

test('live grid preserves two sensors of the same type and source zones', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const cards = buildSensorGrid([
    { id: 'r1', sensorId: 'north', value: 1840, receivedAt: new Date(now - 500).toISOString(), quality: 'valid', source: 'device_wifi' },
    { id: 'r2', sensorId: 'south', value: 2120, zonePosition: 'South Zone', receivedAt: new Date(now - 600).toISOString(), quality: 'valid', source: 'device_wifi' },
  ], [{ id: 'north', kind: 'soil_moisture', zonePosition: 'North Zone' }, { id: 'south', kind: 'soil_moisture' }], { transport: 'wifi', status: 'connected' }, now).filter((card) => card.kind === 'soil_moisture');
  assert.deepEqual(cards.map((card) => card.value), [1840, 2120]);
  assert.deepEqual(cards.map((card) => card.position), ['North Zone', 'South Zone']);
  assert.ok(cards.every((card) => card.raw));
});

test('new field sensor language is available in English and Hindi', () => {
  for (const key of ['fieldSensorReadings', 'sensorFieldHub', 'sensorPositionNotAdded', 'sensorNoFieldHub', 'sensorNoFieldHubDetail']) {
    assert.ok(translate('en', key)); assert.ok(translate('hi', key));
  }
});

test('bottom tab buttons show labeled icons and expose screen labels and navigation hints', async () => {
  const source = await readFile(new URL('src/app/(tabs)/_layout.tsx', root), 'utf8');
  assert.match(source, /tabBarShowLabel: true/);
  assert.match(source, /tabBarAccessibilityLabel/);
  assert.match(source, /accessibilityHint/);
  assert.match(source, /name="farm" options=\{\{ title: translate\(language, 'tabField'\)/);
  assert.match(source, /SymbolView/);
});

test('starter sensor profiles classify soil and rain while retaining raw input', () => {
  assert.equal(interpretSensorValue('soil_moisture', 4000)?.key, 'soilDry');
  assert.equal(interpretSensorValue('soil_moisture', 2400)?.key, 'soilMoist');
  assert.equal(interpretSensorValue('soil_moisture', 1000)?.key, 'soilWet');
  assert.equal(interpretSensorValue('rain', 3500)?.key, 'rainNone');
  assert.equal(interpretSensorValue('rain', 2200)?.key, 'rainDetected');
  assert.ok(['light', 'moderate', 'heavy'].includes(interpretSensorValue('rain', 2200)?.intensity ?? ''));
  assert.equal(SENSOR_STARTER_CALIBRATION.soil.dryRaw, 3300);
});

test('sensor alerts are source-specific and collapse duplicate updates by sensor', () => {
  const now = Date.parse('2026-01-01T00:00:02Z');
  const alerts = buildSensorAlerts([
    { sensorId: 'rain-s', value: 2200, receivedAt: new Date(now - 1000).toISOString(), quality: 'valid' },
    { sensorId: 'rain-s', value: 2300, receivedAt: new Date(now - 500).toISOString(), quality: 'valid' },
    { sensorId: 'soil-n', value: 4000, receivedAt: new Date(now - 1000).toISOString(), quality: 'valid' },
  ], [{ id: 'rain-s', kind: 'rain', zonePosition: 'South' }, { id: 'soil-n', kind: 'soil_moisture', zonePosition: 'North' }], 'connected', now);
  assert.deepEqual(alerts.map((alert) => alert.key), ['rainDetected', 'soilDry']);
  assert.deepEqual(alerts.map((alert) => alert.position), ['South', 'North']);
});

test('modified tab labels and sensor states are localized in English and Hindi', () => {
  for (const key of ['tabHome', 'tabField', 'tabMonitor', 'tabMore', 'soilDry', 'soilMoist', 'soilWet', 'rainDetected', 'rainIntensity', 'soilDryAlert']) {
    assert.ok(translate('en', key)); assert.ok(translate('hi', key));
  }
});

test('the same Earth-and-crops mark is referenced by shared product UI and app icons', async () => {
  const [page, config, mark, icon, splash] = await Promise.all([
    readFile(new URL('src/components/ui/prithvi-page.tsx', root), 'utf8'),
    readFile(new URL('app.json', root), 'utf8'),
    readFile(new URL('assets/branding/prithvi-mark-transparent.svg', root), 'utf8'),
    readFile(new URL('assets/branding/prithvi-icon.png', root)),
    readFile(new URL('assets/branding/prithvi-splash.png', root)),
  ]);
  assert.match(mark, /earth and crops mark/);
  assert.match(page, /prithvi-mark\.png/);
  assert.match(config, /prithvi-icon\.png/);
  assert.ok(icon.byteLength > 1000); assert.ok(splash.byteLength > 1000);
});

test('offline startup is independent of hosted credentials and laptop services', async () => {
  const [welcome, packageFile] = await Promise.all([
    readFile(new URL('src/app/index.tsx', root), 'utf8'),
    readFile(new URL('package.json', root), 'utf8'),
  ]);
  assert.match(welcome, /continueOffline/);
  assert.match(welcome, /router\.replace\('\/\(tabs\)'\)/);
  assert.doesNotMatch(packageFile, /fastapi|uvicorn/i);
});
