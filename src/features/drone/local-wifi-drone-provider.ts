import { normalizeLocalServiceUrl } from '../ai/local-service-config.ts';
import type { DroneTelemetry } from '@/domain/models';
import type { DroneTelemetryProvider, TelemetrySnapshot } from './drone-types';
import { DroneRepository, type DroneStore } from './drone-repository.ts';
import { parseTelemetryJson, TelemetryParseError } from './telemetry-parser.ts';

const CONFIG_ID = 'drone-telemetry-url';
const POLL_MS = 2_000;
const TIMEOUT_MS = 5_000;
export class LocalWifiDroneProvider implements DroneTelemetryProvider {
  private readonly repository: DroneRepository;
  private readonly store: DroneStore;
  private readonly fetcher: typeof fetch;
  private snapshot: TelemetrySnapshot = { status: 'unconfigured', detail: 'Drone telemetry not configured.' };
  private listeners = new Set<(snapshot: TelemetrySnapshot) => void>();
  private running = false; private inFlight = false; private timer?: ReturnType<typeof setTimeout>; private controller?: AbortController; private generation = 0;
  constructor(repository: DroneRepository, store: DroneStore, fetcher: typeof fetch = fetch) { this.repository = repository; this.store = store; this.fetcher = fetcher; }
  async configureBaseUrl(value: string) { const normalized = value.trim() ? normalizeLocalServiceUrl(value, 'drone telemetry') : ''; await this.store.save('app-config', { id: CONFIG_ID, value: normalized, syncState: 'local' }); this.stop(); this.set(normalized ? { status: 'disconnected', detail: 'Address saved. Connect to the local telemetry bridge to receive readings.' } : { status: 'unconfigured', detail: 'Drone telemetry not configured.' }); return normalized; }
  async getConfiguredBaseUrl() { const value = (await this.store.get?.<{ value: string }>('app-config', CONFIG_ID))?.value; return value || undefined; }
  getStatus() { return this.snapshot; }
  async getLatestTelemetry() { return this.repository.getLatestTelemetry(); }
  subscribe(listener: (snapshot: TelemetrySnapshot) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async start() { if (this.running) return; this.running = true; const url = await this.getConfiguredBaseUrl(); if (!url) { this.set({ status: 'unconfigured', detail: 'Drone telemetry not configured.' }); return; } this.set({ status: 'connecting', detail: 'Connecting to the local telemetry bridge…' }); await this.poll(url, this.generation); }
  stop() { this.running = false; this.generation += 1; if (this.timer) clearTimeout(this.timer); this.controller?.abort(); this.controller = undefined; this.inFlight = false; }
  private async poll(baseUrl: string, generation: number) {
    if (!this.running || this.inFlight) return;
    this.inFlight = true; this.controller = new AbortController(); const timeout = setTimeout(() => this.controller?.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(`${baseUrl}/telemetry`, { method: 'GET', headers: { Accept: 'application/json' }, signal: this.controller.signal });
      if (!response.ok) throw new Error(`Telemetry bridge returned HTTP ${response.status}.`);
      const data: unknown = await response.json();
      const telemetry = parseTelemetryJson(data);
      if (generation !== this.generation || !this.running) return;
      await this.repository.recordTelemetry(telemetry);
      this.set({ status: telemetry.connectionState === 'connected' ? 'connected' : 'disconnected', telemetry, detail: telemetry.connectionState === 'connected' ? 'Receiving local telemetry.' : 'Bridge reports it is disconnected.' });
    } catch (error) {
      if (generation !== this.generation || !this.running) return;
      await this.repository.markDisconnected();
      const timeoutError = error instanceof Error && error.name === 'AbortError';
      const invalidResponse = error instanceof TelemetryParseError || (error instanceof Error && error instanceof SyntaxError);
      const httpError = error instanceof Error && error.message.includes('returned HTTP');
      this.set({ status: invalidResponse || httpError ? 'error' : 'disconnected', telemetry: undefined, detail: timeoutError ? 'No response from the local telemetry bridge.' : error instanceof Error ? error.message : 'Could not read drone telemetry.' });
    } finally {
      clearTimeout(timeout); this.inFlight = false; this.controller = undefined;
      if (this.running && generation === this.generation) this.timer = setTimeout(() => { void this.poll(baseUrl, generation); }, POLL_MS);
    }
  }
  private set(snapshot: TelemetrySnapshot) { this.snapshot = snapshot; for (const listener of this.listeners) listener(snapshot); }
}

/** Empty by design; this provider is safe for tests and never seeds UI telemetry. */
export class MockDroneProvider implements DroneTelemetryProvider {
  async configureBaseUrl(value: string) { return value.trim() ? normalizeLocalServiceUrl(value, 'drone telemetry') : ''; }
  async getConfiguredBaseUrl() { return undefined; }
  getStatus(): TelemetrySnapshot { return { status: 'unconfigured', detail: 'Drone telemetry not configured.' }; }
  async getLatestTelemetry(): Promise<DroneTelemetry | undefined> { return undefined; }
  subscribe() { return () => undefined; }
  async start() {}
  stop() {}
}
