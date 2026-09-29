import type { AIProvider } from './ai-provider.ts';
import { OnDeviceAIUnavailableError, type AIAnalysisMetadata, type AIAnalysisResult } from './ai-types.ts';

export interface OnDeviceAIImplementation {
  getStatus(): Promise<{ status: 'ready' | 'loading' | 'unavailable'; detail: string }>;
  analyzeImage(imageUri: string, metadata?: AIAnalysisMetadata): Promise<AIAnalysisResult>;
}

interface OptionalServerProvider {
  getConfiguredBaseUrl(): Promise<string | undefined>;
  configureBaseUrl(value: string): Promise<string>;
  checkHealth(): Promise<{ available: boolean; modelAvailable: boolean; reason?: string }>;
  analyzeImage(imageUri: string, metadata: AIAnalysisMetadata): Promise<AIAnalysisResult>;
}

interface PreferenceStore {
  get<T>(type: string, id: string): Promise<T | undefined>;
  save<T extends { id: string }>(type: string, value: T): Promise<T>;
}

type AISettings = { id: string; allowOptionalServerFallback: boolean };
const SETTINGS_TYPE = 'ai-preferences';
const SETTINGS_ID = 'provider-priority';

/** On-device first; server fallback is entirely opt-in and never health-checked before local inference. */
export class PriorityAIProvider implements AIProvider {
  private readonly onDevice: OnDeviceAIImplementation;
  private readonly optionalServer: OptionalServerProvider;
  private readonly store: PreferenceStore;

  constructor(onDevice: OnDeviceAIImplementation, optionalServer: OptionalServerProvider, store: PreferenceStore) {
    this.onDevice = onDevice;
    this.optionalServer = optionalServer;
    this.store = store;
  }

  getConfiguredBaseUrl() { return this.optionalServer.getConfiguredBaseUrl(); }
  configureBaseUrl(value: string) { return this.optionalServer.configureBaseUrl(value); }

  async checkHealth() {
    const status = await this.onDevice.getStatus();
    return { available: status.status === 'ready', modelAvailable: status.status === 'ready', reason: status.detail };
  }

  async setOptionalServerFallbackEnabled(enabled: boolean) {
    await this.store.save<AISettings>(SETTINGS_TYPE, { id: SETTINGS_ID, allowOptionalServerFallback: enabled });
  }

  async isOptionalServerFallbackEnabled() {
    try { return (await this.store.get<AISettings>(SETTINGS_TYPE, SETTINGS_ID))?.allowOptionalServerFallback === true; }
    catch { return false; }
  }

  async analyzeImage(imageUri: string, metadata: AIAnalysisMetadata): Promise<AIAnalysisResult> {
    try {
      return await this.onDevice.analyzeImage(imageUri, metadata);
    } catch (error) {
      if (!(error instanceof OnDeviceAIUnavailableError) || !(await this.isOptionalServerFallbackEnabled())) throw error;
      try {
        const result = await this.optionalServer.analyzeImage(imageUri, metadata);
        return { ...result, provider: 'optional_local_server', provenance: ['optional_local_server'] };
      } catch {
        // Keep the primary on-device failure visible; an optional server outage
        // must not replace it or make the server appear required.
        throw error;
      }
    }
  }
}
