import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const appConfig = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8')).expo;

test('retains SDK 57, the selected native TFLite runtime, Nitro, and development client', () => {
  assert.match(packageJson.dependencies.expo, /^~57\./);
  assert.ok(packageJson.dependencies['react-native-fast-tflite']);
  assert.ok(packageJson.dependencies['react-native-nitro-modules']);
  assert.ok(packageJson.dependencies['expo-dev-client']);
  assert.ok(appConfig.plugins.includes('react-native-fast-tflite'));
});

test('enables local HTTP through Expo config and keeps model and labels statically bundled', () => {
  const buildProperties = appConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties');
  assert.deepEqual(buildProperties?.[1]?.android, { usesCleartextTraffic: true });
  assert.ok(existsSync(path.join(root, 'assets/models/prithvi_mobilenetv3_plantvillage.tflite')));
  assert.ok(existsSync(path.join(root, 'assets/models/plantvillage_labels.txt')));
  assert.match(readFileSync(path.join(root, 'metro.config.js'), 'utf8'), /'tflite'.*'txt'/s);
});

test('sample-image development action remains honest when no real image is bundled', () => {
  assert.equal(existsSync(path.join(root, 'assets/test/plant-test.jpg')), false);
  const scan = readFileSync(path.join(root, 'src/app/crop-health-scan.tsx'), 'utf8');
  assert.match(scan, /No test image installed/);
});
