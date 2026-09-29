import type { KisanContext, KisanResponse } from './kisanmitra-types.ts';

export interface KisanMitraProvider { ask(question: string, context: KisanContext, accessToken?: string): Promise<KisanResponse> }
export const KISANMITRA_TIMEOUT_MS = 25_000;

export function validateKisanEndpoint(value: string | undefined): string | undefined {
  const input = value?.trim(); if (!input) return undefined;
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('KisanMitra service URL is invalid.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /(?:^|[_-])(key|secret|token|credential)(?:$|[_-])/i.test(url.search)) throw new Error('KisanMitra service URL is invalid.');
  return url.toString();
}

export function validateKisanResponse(value: unknown): KisanResponse {
  if (!value || typeof value !== 'object') throw new Error('KisanMitra returned an invalid response.');
  const data = value as Record<string, unknown>;
  if (typeof data.answer !== 'string' || !data.answer.trim() || !Array.isArray(data.actions) || !Array.isArray(data.sources) || !['high', 'medium', 'low'].includes(String(data.confidence))) throw new Error('KisanMitra returned an invalid response.');
  const actions = data.actions.slice(0, 3).map((item) => {
    if (!item || typeof item !== 'object') throw new Error('KisanMitra returned an invalid response.');
    const row = item as Record<string, unknown>;
    if (typeof row.title !== 'string' || typeof row.reason !== 'string') throw new Error('KisanMitra returned an invalid response.');
    return { title: row.title.slice(0, 120), reason: row.reason.slice(0, 240) };
  });
  const allowed = new Set(['observation', 'weather', 'sensor', 'price', 'field', 'advisory']);
  const sources = data.sources.slice(0, 10).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    return typeof row.type === 'string' && allowed.has(row.type) && typeof row.reference === 'string' ? [{ type: row.type as KisanResponse['sources'][number]['type'], reference: row.reference.slice(0, 100) }] : [];
  });
  return { answer: data.answer.trim().slice(0, 2400), actions, sources, confidence: data.confidence as KisanResponse['confidence'], needs_verification: true };
}

export class NetlifyKisanMitraProvider implements KisanMitraProvider {
  private readonly endpoint?: string;
  private readonly fetcher: typeof fetch;
  constructor(endpoint = process.env.EXPO_PUBLIC_KISANMITRA_FUNCTION_URL, fetcher: typeof fetch = fetch) { this.endpoint = validateKisanEndpoint(endpoint); this.fetcher = fetcher; }
  async ask(question: string, context: KisanContext, accessToken?: string) {
    if (!this.endpoint) throw new Error('KisanMitra is not configured.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), KISANMITRA_TIMEOUT_MS);
    try {
      const response = await this.fetcher(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ question: question.trim(), context }), signal: controller.signal });
      let data: unknown; try { data = await response.json(); } catch { throw new Error('KisanMitra returned an invalid response.'); }
      if (!response.ok) throw new Error(typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : 'KisanMitra is unavailable right now.');
      return validateKisanResponse(data);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('KisanMitra request timed out.');
      throw error;
    } finally { clearTimeout(timer); }
  }
}
