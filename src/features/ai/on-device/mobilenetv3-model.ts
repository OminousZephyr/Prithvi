import type { AIAnalysisMetadata, AIAnalysisResult } from '../ai-types.ts';
import type { CropScanStatus } from '@/domain/models';
import type { ParsedPlantLabel } from './model-labels.ts';

export const MODEL_ASSET_PATH = 'assets/models/prithvi_mobilenetv3_plantvillage.tflite';
export const LABEL_ASSET_PATH = 'assets/models/plantvillage_labels.txt';
export const MOBILENETV3_MODEL_VERSION = 'MobileNetV3Large-PlantVillage-38-quantized-v1';
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;
export const MODEL_OUTPUT_COUNT = 38;

export interface TensorMetadata { name: string; dataType: string; shape: number[] }

export function validateMobileNetV3TensorContract(inputs: TensorMetadata[], outputs: TensorMetadata[]) {
  if (inputs.length !== 1 || outputs.length !== 1) throw new Error(`Model contract error: expected 1 input and 1 output tensor; found ${inputs.length} and ${outputs.length}.`);
  const input = inputs[0];
  const output = outputs[0];
  if (input.dataType !== 'float32' || !sameShape(input.shape, [1, 224, 224, 3])) {
    throw new Error(`Model contract error: expected input float32 [1,224,224,3], received ${input.dataType} [${input.shape.join(',')}].`);
  }
  if (output.dataType !== 'float32' || !sameShape(output.shape, [1, MODEL_OUTPUT_COUNT])) {
    throw new Error(`Model contract error: expected output float32 [1,${MODEL_OUTPUT_COUNT}], received ${output.dataType} [${output.shape.join(',')}].`);
  }
}

export function interpretPlantVillageOutput(output: Float32Array, labels: ParsedPlantLabel[], metadata: AIAnalysisMetadata, timestamp = new Date().toISOString(), confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD): AIAnalysisResult {
  if (labels.length !== MODEL_OUTPUT_COUNT || output.length !== MODEL_OUTPUT_COUNT) throw new Error(`Model output error: expected ${MODEL_OUTPUT_COUNT} scores and labels, received ${output.length} scores and ${labels.length} labels.`);
  if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) throw new Error('Model configuration error: confidence threshold must be between 0 and 1.');
  let total = 0;
  for (const score of output) {
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('Model output error: expected finite softmax probabilities between 0 and 1.');
    total += score;
  }
  if (Math.abs(total - 1) > 0.02) throw new Error(`Model output error: expected softmax probabilities summing to 1 (received ${total.toFixed(4)}).`);

  const indices = Array.from({ length: output.length }, (_unused, index) => index).sort((a, b) => output[b] - output[a]).slice(0, 3);
  const bestIndex = indices[0];
  const bestLabel = labels[bestIndex];
  if (!bestLabel?.rawLabel) throw new Error(`Model output error: label index ${bestIndex} is missing.`);
  const confidence = output[bestIndex];
  const status: CropScanStatus = confidence < confidenceThreshold ? 'uncertain' : bestLabel.healthy ? 'healthy_looking' : 'possible_issue';
  const observation = status === 'uncertain'
    ? 'AI result is uncertain. Try a clearer close-up of one leaf.'
    : status === 'healthy_looking'
      ? `${bestLabel.crop} — healthy-looking`
      : `Possible crop-health issue: ${bestLabel.crop} — ${bestLabel.condition}`;

  return {
    status,
    crop: bestLabel.crop,
    condition: bestLabel.condition,
    rawLabel: bestLabel.rawLabel,
    confidence,
    observation,
    modelVersion: MOBILENETV3_MODEL_VERSION,
    source: metadata.source ?? 'local_image',
    imageQuality: { status: 'acceptable', reason: null },
    timestamp,
    provider: 'on_device_ai',
    provenance: ['on_device_ai', 'MobileNetV3Large PlantVillage TFLite'],
    inferenceValidated: true,
    topAlternatives: indices.map((index) => ({
      rawLabel: labels[index].rawLabel,
      crop: labels[index].crop,
      condition: labels[index].condition,
      confidence: output[index],
    })),
  };
}

function sameShape(actual: number[], expected: number[]) {
  return actual.length === expected.length && actual.every((dimension, index) => dimension === expected[index]);
}
