import type { AIProvider } from './ai-provider.ts';
import { AIServiceError, type AIAnalysisMetadata, type AIAnalysisResult } from './ai-types.ts';
import { normalizeLocalServiceUrl, readImageDataUrlAsBlob } from './local-service-config.ts';

type SavedAIConfig = { id: string; baseUrl: string };
interface AIConfigStore { get<T>(type: string, id: string): Promise<T | undefined>; save<T extends { id: string }>(type: string, value: T): Promise<T> }
type Fetcher = typeof fetch;
const CONFIG_TYPE = 'local-service-config';
const CONFIG_ID = 'crop-health-ai';

export class LocalAIProvider implements AIProvider {
  private baseUrl?: string;
  private readonly store: AIConfigStore;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  constructor(store: AIConfigStore, fetcher: Fetcher = fetch, timeoutMs = 20_000) { this.store = store; this.fetcher = fetcher; this.timeoutMs = timeoutMs; }

  async getConfiguredBaseUrl() {
    if (this.baseUrl) return this.baseUrl;
    try { this.baseUrl = (await this.store.get<SavedAIConfig>(CONFIG_TYPE, CONFIG_ID))?.baseUrl; } catch { /* handled as unconfigured */ }
    return this.baseUrl;
  }

  async configureBaseUrl(value: string) {
    const baseUrl = normalizeLocalServiceUrl(value, 'AI service');
    await this.store.save(CONFIG_TYPE, { id: CONFIG_ID, baseUrl });
    this.baseUrl = baseUrl;
    return baseUrl;
  }

  async checkHealth() {
    const baseUrl = await this.getConfiguredBaseUrl();
    if (!baseUrl) return { available: false, modelAvailable: false, reason: 'Local AI service is not configured.' };
    try {
      const data = await this.requestJson(`${baseUrl}/health`, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AIServiceError('AI service returned an unreadable health response.', 'malformed');
      const health = data as Record<string, unknown>;
      return { available: health.status === 'ok', modelAvailable: health.model_available === true, reason: typeof health.reason === 'string' ? health.reason : undefined };
    } catch (error) {
      if (error instanceof AIServiceError && error.kind === 'malformed') throw error;
      return { available: false, modelAvailable: false, reason: error instanceof Error ? error.message : 'AI service is unreachable.' };
    }
  }

  async analyzeImage(imageUri: string, metadata: AIAnalysisMetadata): Promise<AIAnalysisResult> {
    const baseUrl = await this.getConfiguredBaseUrl();
    if (!baseUrl) throw new AIServiceError('Configure the local AI service in Settings first.', 'unconfigured');
    const blob = metadata.imageBlob ?? await readImageDataUrlAsBlob(imageUri).catch(() => { throw new AIServiceError('Captured image is unavailable. Capture it again.', 'malformed'); });
    if (!blob.size) throw new AIServiceError('Captured image is empty.', 'malformed');

    const form = new FormData();
    form.append('file', blob, 'capture.jpg');
    const { imageBlob: _imageBlob, ...safeMetadata } = metadata;
    form.append('metadata', JSON.stringify(safeMetadata));
    const response = await this.request(`${baseUrl}/analyze`, { method: 'POST', headers: { Accept: 'application/json' }, body: form });
    if (!response.ok) throw new AIServiceError(`AI service returned HTTP ${response.status}.`, 'http');
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new AIServiceError('AI service returned malformed JSON.', 'malformed'); }
    return parseAIAnalysisResult(payload);
  }

  private async requestJson(url: string, init: RequestInit) {
    const response = await this.request(url, init);
    if (!response.ok) throw new AIServiceError(`AI service returned HTTP ${response.status}.`, 'http');
    try { return await response.json(); } catch { throw new AIServiceError('AI service returned malformed JSON.', 'malformed'); }
  }

  private async request(url: string, init: RequestInit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try { return await this.fetcher(url, { ...init, signal: controller.signal }); }
    catch { throw new AIServiceError(controller.signal.aborted ? 'AI service request timed out.' : 'AI service is unreachable on this local network.', controller.signal.aborted ? 'timeout' : 'unreachable'); }
    finally { clearTimeout(timeout); }
  }
}

export function parseAIAnalysisResult(value: unknown): AIAnalysisResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIServiceError('AI service response has an invalid shape.', 'malformed');
  const result = value as Record<string, unknown>;
  const allowed = ['healthy_looking', 'possible_issue', 'uncertain', 'unavailable'];
  const quality = result.image_quality;
  if (!allowed.includes(String(result.status)) || !quality || typeof quality !== 'object' || Array.isArray(quality)) {
    throw new AIServiceError('AI service response is missing a valid status or image-quality result.', 'malformed');
  }
  const qualityResult = quality as Record<string, unknown>;
  if (!['acceptable', 'low', 'unknown'].includes(String(qualityResult.status))) throw new AIServiceError('AI service returned an invalid image-quality status.', 'malformed');
  const confidence = result.confidence;
  if (confidence !== undefined && confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new AIServiceError('AI service returned an invalid confidence value.', 'malformed');
  }
  if (result.status !== 'unavailable' && (confidence === undefined || confidence === null || typeof result.model_version !== 'string' || !result.model_version || typeof result.observation !== 'string' || !result.observation)) {
    throw new AIServiceError('A model result must include its model version, confidence, and observation.', 'malformed');
  }
  return {
    status: result.status as AIAnalysisResult['status'], reason: typeof result.reason === 'string' ? result.reason : null,
    crop: typeof result.crop === 'string' ? result.crop : 'unknown', condition: typeof result.condition === 'string' ? result.condition : 'unknown',
    confidence: typeof confidence === 'number' ? confidence : null, observation: typeof result.observation === 'string' ? result.observation : null,
    modelVersion: typeof result.model_version === 'string' ? result.model_version : null,
    source: result.source === 'esp32_cam_rgb' || result.source === 'manual_photo' || result.source === 'local_image' ? result.source : (() => { throw new AIServiceError('AI service returned an unknown image source.', 'malformed'); })(),
    provider: 'optional_local_server',
    imageQuality: { status: qualityResult.status as AIAnalysisResult['imageQuality']['status'], reason: typeof qualityResult.reason === 'string' ? qualityResult.reason : null },
    timestamp: typeof result.timestamp === 'string' ? result.timestamp : new Date().toISOString(),
  };
}
