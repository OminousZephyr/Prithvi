import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import jpeg from 'jpeg-js';
import { decodeJpegToRGB } from '../../src/features/ai/on-device/image-decoder.ts';
import { parsePlantVillageLabel, parsePlantVillageLabels } from '../../src/features/ai/on-device/model-labels.ts';
import { DEFAULT_CONFIDENCE_THRESHOLD, interpretPlantVillageOutput, validateMobileNetV3TensorContract } from '../../src/features/ai/on-device/mobilenetv3-model.ts';
import { resizeRGBToFloat32 } from '../../src/features/ai/on-device/mobilenetv3-preprocess.ts';

const root = process.cwd();
const modelPath = path.join(root, 'assets/models/prithvi_mobilenetv3_plantvillage.tflite');
const labelsPath = path.join(root, 'assets/models/plantvillage_labels.txt');
const labels = parsePlantVillageLabels(readFileSync(labelsPath, 'utf8'));

test('selected model asset exists and is a non-empty TFLite FlatBuffer', () => {
  assert.ok(existsSync(modelPath));
  const modelBytes = readFileSync(modelPath);
  assert.ok(modelBytes.length > 100_000);
  assert.equal(modelBytes.toString('ascii', 4, 8), 'TFL3');
});

test('matching label asset exists and contains exactly 38 output classes', async () => {
  assert.ok(existsSync(labelsPath));
  assert.equal(labels.length, 38);
  assert.equal((await readFile(labelsPath, 'utf8')).trim().split(/\r?\n/).length, 38);
});

test('parses healthy and disease PlantVillage labels while retaining raw labels', () => {
  const healthy = parsePlantVillageLabel('Apple___healthy');
  assert.deepEqual({ crop: healthy.crop, condition: healthy.condition, healthy: healthy.healthy, rawLabel: healthy.rawLabel }, { crop: 'Apple', condition: 'healthy', healthy: true, rawLabel: 'Apple___healthy' });
  const disease = parsePlantVillageLabel('Potato___Late_blight');
  assert.equal(disease.crop, 'Potato');
  assert.equal(disease.condition, 'Late blight');
  assert.equal(disease.healthy, false);
});

test('rejects label files with the wrong number of classes or malformed labels', () => {
  assert.throws(() => parsePlantVillageLabels('Apple___healthy'), /expected 38/i);
  assert.throws(() => parsePlantVillageLabel('not-a-plant-label'), /invalid plantvillage label/i);
});

test('validates runtime tensor count, type, and shape rather than assuming the model contract', () => {
  validateMobileNetV3TensorContract([{ name: 'serving_default_input', dataType: 'float32', shape: [1, 224, 224, 3] }], [{ name: 'Identity', dataType: 'float32', shape: [1, 38] }]);
  assert.throws(() => validateMobileNetV3TensorContract([{ name: 'x', dataType: 'uint8', shape: [1, 224, 224, 3] }], [{ name: 'y', dataType: 'float32', shape: [1, 38] }]), /input float32/i);
  assert.throws(() => validateMobileNetV3TensorContract([{ name: 'x', dataType: 'float32', shape: [1, 224, 224, 3] }], [{ name: 'y', dataType: 'float32', shape: [1, 37] }]), /output float32/i);
});

test('calculates top confidence, alternatives, and cautious status from model probabilities', () => {
  const scores = new Float32Array(38);
  scores[21] = 0.84;
  scores[22] = 0.10;
  scores[20] = 0.06;
  const result = interpretPlantVillageOutput(scores, labels, { source: 'esp32_cam_rgb' }, '2026-01-01T00:00:00Z');
  assert.equal(result.confidence, scores[21]);
  assert.equal(result.crop, 'Potato');
  assert.equal(result.condition, 'Late blight');
  assert.equal(result.rawLabel, 'Potato___Late_blight');
  assert.equal(result.status, 'possible_issue');
  assert.equal(result.topAlternatives?.length, 3);
  assert.equal(result.provider, 'on_device_ai');
  assert.equal(result.inferenceValidated, true);
});

test('healthy classes stay healthy-looking and low confidence abstains as uncertain', () => {
  const healthyIndex = labels.findIndex((label) => label.rawLabel === 'Tomato___healthy');
  const healthy = new Float32Array(38); healthy[healthyIndex] = 1;
  assert.equal(interpretPlantVillageOutput(healthy, labels, {}).status, 'healthy_looking');
  const low = new Float32Array(38); low.fill(1 / 38);
  assert.equal(DEFAULT_CONFIDENCE_THRESHOLD, 0.65);
  assert.equal(interpretPlantVillageOutput(low, labels, {}).status, 'uncertain');
});

test('rejects malformed model output and invalid confidence threshold', () => {
  assert.throws(() => interpretPlantVillageOutput(new Float32Array(37), labels, {}), /expected 38/i);
  const malformed = new Float32Array(38); malformed[0] = Number.NaN;
  assert.throws(() => interpretPlantVillageOutput(malformed, labels, {}), /finite softmax probabilities/i);
  const unnormalized = new Float32Array(38); unnormalized[0] = 0.5;
  assert.throws(() => interpretPlantVillageOutput(unnormalized, labels, {}), /summing to 1/i);
  assert.throws(() => interpretPlantVillageOutput(new Float32Array(38).fill(1 / 38), labels, {}, undefined, 2), /threshold/i);
});

test('input preprocessing returns 224x224x3 raw 0..255 float32 without extra normalization', () => {
  const image = { width: 2, height: 2, data: new Uint8Array([255, 100, 0, 255, 100, 0, 255, 100, 0, 255, 100, 0]) };
  const resized = resizeRGBToFloat32(image, 2, 2);
  assert.deepEqual([...resized.slice(0, 3)], [255, 100, 0]);
  assert.equal(resizeRGBToFloat32(image).length, 224 * 224 * 3);
  assert.equal(resizeRGBToFloat32(image)[0], 255);
});

test('JPEG decoding converts a real encoded JPEG to RGB and rejects non-JPEG input', () => {
  const rgba = new Uint8Array(96 * 96 * 4);
  for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 80; rgba[i + 1] = 140; rgba[i + 2] = 50; rgba[i + 3] = 255; }
  const jpegBytes = jpeg.encode({ data: rgba, width: 96, height: 96 }, 90).data;
  const decoded = decodeJpegToRGB(jpegBytes);
  assert.equal(decoded.width, 96);
  assert.equal(decoded.height, 96);
  assert.equal(decoded.data.length, 96 * 96 * 3);
  assert.throws(() => decodeJpegToRGB(new Uint8Array([1, 2, 3])), /not a supported jpeg/i);
});
