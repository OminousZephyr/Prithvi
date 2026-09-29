import type { AIAnalysisMetadata, AIAnalysisResult } from './ai-types.ts';

export interface AIProvider {
  getConfiguredBaseUrl(): Promise<string | undefined>;
  configureBaseUrl(value: string): Promise<string>;
  checkHealth(): Promise<{ available: boolean; modelAvailable: boolean; reason?: string }>;
  analyzeImage(imageUri: string, metadata: AIAnalysisMetadata): Promise<AIAnalysisResult>;
}
