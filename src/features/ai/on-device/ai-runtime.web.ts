import { OnDeviceAIUnavailableError, type AIAnalysisMetadata, type AIAnalysisResult } from '../ai-types.ts';

export type OnDeviceModelStatus = { status: 'ready' | 'loading' | 'unavailable'; detail: string };

export class MobileNetV3OnDeviceProvider {
  async getStatus(): Promise<OnDeviceModelStatus> {
    return { status: 'unavailable', detail: 'On-device TFLite inference requires an Android or iOS development build.' };
  }

  async analyzeImage(_imageUri: string, _metadata: AIAnalysisMetadata = {}): Promise<AIAnalysisResult> {
    throw new OnDeviceAIUnavailableError('On-device TFLite inference is not available in the web preview.');
  }
}
