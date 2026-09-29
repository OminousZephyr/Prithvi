import { Asset } from 'expo-asset';
import { AIImageInputError, OnDeviceAIUnavailableError, type AIAnalysisMetadata, type AIAnalysisResult } from '../ai-types.ts';
import { decodeJpegToRGB, loadJpegBytes } from './image-decoder.ts';
import { parsePlantVillageLabels, type ParsedPlantLabel } from './model-labels.ts';
import { DEFAULT_CONFIDENCE_THRESHOLD, interpretPlantVillageOutput, LABEL_ASSET_PATH, MODEL_ASSET_PATH, validateMobileNetV3TensorContract } from './mobilenetv3-model.ts';
import { resizeRGBToFloat32 } from './mobilenetv3-preprocess.ts';

declare const require: (path: string) => number;
const MODEL_ASSET = require('../../../../assets/models/prithvi_mobilenetv3_plantvillage.tflite');
const LABELS_ASSET = require('../../../../assets/models/plantvillage_labels.txt');

type LoadedModel = Awaited<ReturnType<typeof import('react-native-fast-tflite').loadTensorflowModel>>;
export type OnDeviceModelStatus = { status: 'ready' | 'loading' | 'unavailable'; detail: string };

export class MobileNetV3OnDeviceProvider {
  private loadPromise?: Promise<{ model: LoadedModel; labels: ParsedPlantLabel[] }>;
  private status: OnDeviceModelStatus = { status: 'loading', detail: 'MobileNetV3 model has not loaded yet.' };

  constructor(private readonly confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD) {}

  async getStatus(): Promise<OnDeviceModelStatus> {
    try {
      await this.loadModel();
      this.status = { status: 'ready', detail: 'MobileNetV3 PlantVillage model is ready on this device.' };
    } catch (error) {
      this.status = { status: 'unavailable', detail: toMessage(error) };
    }
    return this.status;
  }

  async analyzeImage(imageUri: string, metadata: AIAnalysisMetadata = {}): Promise<AIAnalysisResult> {
    metadata.onProgress?.('checking_image');
    let input: Float32Array;
    try {
      const bytes = await loadJpegBytes(imageUri);
      input = resizeRGBToFloat32(decodeJpegToRGB(bytes));
    } catch (error) {
      throw new AIImageInputError(toMessage(error));
    }

    let loaded: { model: LoadedModel; labels: ParsedPlantLabel[] };
    try {
      loaded = await this.loadModel();
    } catch (error) {
      this.status = { status: 'unavailable', detail: toMessage(error) };
      throw new OnDeviceAIUnavailableError(this.status.detail);
    }

    try {
      metadata.onProgress?.('analyzing');
      const outputBuffers = await loaded.model.run([input.buffer as ArrayBuffer]);
      if (outputBuffers.length !== 1) throw new Error(`Model output error: expected one output tensor, received ${outputBuffers.length}.`);
      const output = new Float32Array(outputBuffers[0]);
      metadata.onProgress?.('preparing_result');
      return interpretPlantVillageOutput(output, loaded.labels, metadata, new Date().toISOString(), this.confidenceThreshold);
    } catch (error) {
      if (error instanceof OnDeviceAIUnavailableError) throw error;
      throw new OnDeviceAIUnavailableError(toMessage(error));
    }
  }

  private loadModel() {
    if (!this.loadPromise) {
      this.status = { status: 'loading', detail: 'Loading the on-device crop model…' };
      this.loadPromise = this.loadModelAndLabels().catch((error: unknown) => {
        this.loadPromise = undefined;
        throw error;
      });
    }
    return this.loadPromise;
  }

  private async loadModelAndLabels() {
    const labelsAsset = await Asset.fromModule(LABELS_ASSET).downloadAsync();
    const labelsUri = labelsAsset.localUri;
    if (!labelsUri) throw new Error(`Model configuration error: ${LABEL_ASSET_PATH} is not available in the app bundle.`);
    const labelResponse = await fetch(labelsUri);
    if (!labelResponse.ok) throw new Error(`Model configuration error: labels could not be read (${labelResponse.status}).`);
    const labels = parsePlantVillageLabels(await labelResponse.text());

    // Load only with the default CPU delegate. Runtime metadata is verified before use.
    const { loadTensorflowModel } = await import('react-native-fast-tflite');
    const model = await loadTensorflowModel(MODEL_ASSET, []);
    validateMobileNetV3TensorContract(model.inputs, model.outputs);
    if (!MODEL_ASSET) throw new Error(`Model configuration error: ${MODEL_ASSET_PATH} is missing from the app bundle.`);
    return { model, labels };
  }
}

function toMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load or run the on-device crop model.';
}
