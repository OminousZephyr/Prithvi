import type { SensorConnection, SensorKind } from '@/domain/models';
import type { SensorProvider } from '@/domain/ports/repositories';
import type { SensorRepository, SensorService } from '@/features/sensors/contracts';
import { SENSOR_OFFLINE_AFTER_MS, SENSOR_STALE_AFTER_MS } from './sensor-repository-core.ts';
import { parseEsp32SensorPayload } from './protocol/esp32-jsonl.ts';

export interface SensorConfigStore {
  get<T>(type: string, id: string): Promise<T | undefined>;
  save<T extends { id: string }>(type: string, value: T): Promise<T>;
}

export interface WifiSensorProviderOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

type SavedSensorConfig = { id: string; baseUrl: string };
const CONFIG_TYPE = 'sensor-config';
const CONFIG_ID = 'esp32-wifi';

/** Local HTTP poller. Each request completes or times out before the next begins. */
export class WifiSensorProvider implements SensorProvider, SensorService {
  private readonly repository: SensorRepository;
  private readonly configStore: SensorConfigStore;
  private readonly options: WifiSensorProviderOptions;
  private listeners = new Set<() => void>();
  private connection: SensorConnection = { transport: 'wifi', status: 'unconfigured', detail: 'No ESP32 address configured.' };
  private baseUrl?: string;
  private running = false;
  private loop?: Promise<void>;
  private starting?: Promise<SensorConnection>;
  private controller?: AbortController;
  private freshnessTimer?: ReturnType<typeof setInterval>;
  private wakeLoop?: () => void;
  private generation = 0;

  constructor(
    repository: SensorRepository,
    configStore: SensorConfigStore,
    options: WifiSensorProviderOptions = {},
  ) { this.repository = repository; this.configStore = configStore; this.options = options; }

  getConnection() { return this.connection; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }

  async getConfiguredBaseUrl() {
    if (this.baseUrl) return this.baseUrl;
    try { this.baseUrl = (await this.configStore.get<SavedSensorConfig>(CONFIG_TYPE, CONFIG_ID))?.baseUrl; } catch { /* show configuration as missing; storage errors do not crash UI */ }
    return this.baseUrl;
  }

  async configureBaseUrl(value: string) {
    const baseUrl = normalizeBaseUrl(value);
    const shouldRestart = this.running || Boolean(this.starting);
    await this.configStore.save(CONFIG_TYPE, { id: CONFIG_ID, baseUrl });
    this.baseUrl = baseUrl;
    this.connection = { transport: 'wifi', status: 'connecting', detail: 'Connecting to ESP32.' };
    this.notify();
    if (shouldRestart) { await this.stop(); await this.start(); }
    return baseUrl;
  }

  start(): Promise<SensorConnection> {
    if (this.running) return Promise.resolve(this.connection);
    if (this.starting) return this.starting;
    const generation = ++this.generation;
    this.starting = this.open(generation);
    return this.starting.finally(() => { this.starting = undefined; });
  }

  private async open(generation: number): Promise<SensorConnection> {
    const baseUrl = await this.getConfiguredBaseUrl();
    if (generation !== this.generation) return this.connection;
    if (!baseUrl) {
      this.connection = { transport: 'wifi', status: 'unconfigured', detail: 'No ESP32 address configured.' };
      this.notify();
      return this.connection;
    }
    this.running = true;
    this.connection = { transport: 'wifi', status: 'connecting', detail: 'Connecting to ESP32.' };
    this.notify();
    try {
      await this.verifyHealthEndpoint(baseUrl, generation);
    } catch (error) {
      if (generation === this.generation) this.fail('disconnected', error instanceof Error ? error.message : 'ESP32 health check failed.');
      return this.connection;
    }
    if (!this.running || generation !== this.generation) return this.connection;
    const freshnessCheckMs = Math.max(1, Math.min(this.options.pollIntervalMs ?? 2_000, 1_000));
    this.freshnessTimer = setInterval(() => { if (this.running && generation === this.generation) this.updateFreshness(); }, freshnessCheckMs);
    this.loop = this.pollLoop(baseUrl, generation);
    return this.connection;
  }

  /** Verifies the configured ESP32 without treating its health response as a sensor reading. */
  async checkEndpointHealth() {
    const baseUrl = await this.getConfiguredBaseUrl();
    if (!baseUrl) return { available: false, detail: 'No ESP32 address configured.' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 4_000);
    try {
      const response = await (this.options.fetcher ?? fetch)(`${baseUrl}/health`, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
      await validateHealthResponse(response);
      return { available: true, detail: 'ESP32 health endpoint is responding.' };
    } catch (error) {
      return { available: false, detail: controller.signal.aborted ? 'ESP32 health check timed out.' : error instanceof Error ? error.message : 'ESP32 health check failed.' };
    } finally { clearTimeout(timeout); }
  }

  private async verifyHealthEndpoint(baseUrl: string, generation: number) {
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 4_000);
    try {
      const response = await (this.options.fetcher ?? fetch)(`${baseUrl}/health`, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
      await validateHealthResponse(response);
      if (generation !== this.generation || !this.running) return;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('ESP32 health check timed out.');
      if (error instanceof Error && (error.message.includes('HTTP') || error.message.includes('invalid') || error.message.includes('JSON') || error.message.includes('timed out'))) throw error;
      throw new Error('ESP32 health endpoint is unreachable on this Wi-Fi network.');
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  async stop() {
    this.running = false;
    this.generation += 1;
    if (this.freshnessTimer) clearInterval(this.freshnessTimer);
    this.freshnessTimer = undefined;
    this.controller?.abort();
    this.controller = undefined;
    this.wakeLoop?.();
    await this.starting;
    await this.loop;
    this.loop = undefined;
    this.connection = { transport: 'wifi', status: this.baseUrl ? 'disconnected' : 'unconfigured', detail: this.baseUrl ? 'ESP32 connection stopped.' : 'No ESP32 address configured.' };
    this.notify();
  }

  private async pollLoop(baseUrl: string, generation: number) {
    while (this.running && generation === this.generation) {
      await this.pollOnce(baseUrl, generation);
      if (!this.running || generation !== this.generation) break;
      const delay = this.options.pollIntervalMs ?? 2_000;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        this.wakeLoop = () => { clearTimeout(timer); resolve(); };
      });
      this.wakeLoop = undefined;
      this.updateFreshness();
    }
  }

  private async pollOnce(baseUrl: string, generation: number) {
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 4_000);
    let saving = false;
    try {
      const response = await (this.options.fetcher ?? fetch)(`${baseUrl}/sensors`, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!this.running || generation !== this.generation) return;
      if (!response.ok) {
        this.fail('error', `ESP32 returned HTTP ${response.status}.`);
        return;
      }
      let payload: unknown;
      try { payload = await response.json(); } catch { this.fail('error', 'ESP32 response was not valid JSON.'); return; }
      if (!this.running || generation !== this.generation) return;
      const parsed = parseEsp32SensorPayload(payload);
      if (!parsed.ok) { this.fail('error', 'ESP32 response is missing a valid device ID or sensor data.'); return; }
      const frame = parsed.frame;
      const receivedAt = (this.options.now?.() ?? new Date()).toISOString();
      const values: Partial<Record<SensorKind, { value?: number; quality: 'valid' | 'invalid'; detail?: string }>> = {};
      for (const kind of ['temperature', 'humidity', 'soil_moisture', 'rain'] as const) {
        const value = kind === 'temperature' ? frame.temperatureC : kind === 'humidity' ? frame.humidityPct : kind === 'soil_moisture' ? frame.soilRaw : frame.rainRaw;
        values[kind] = { value: value ?? undefined, quality: frame.fieldQuality[kind].valid ? 'valid' : 'invalid', detail: frame.fieldQuality[kind].detail };
      }
      saving = true;
      await this.repository.saveFrame(frame.deviceId, receivedAt, values, frame.deviceTimestamp, 'device_wifi');
      if (!this.running || generation !== this.generation) return;
      this.connection = { transport: 'wifi', status: 'connected', deviceId: frame.deviceId, lastReceivedAt: receivedAt, detail: 'Receiving sensor readings.' };
      this.notify();
    } catch {
      if (!this.running || generation !== this.generation) return;
      const timedOut = controller.signal.aborted;
      this.fail(saving ? 'error' : 'disconnected', saving ? 'Sensor data could not be saved on this device.' : timedOut ? 'ESP32 did not respond before the request timed out.' : 'ESP32 is unreachable on this Wi-Fi network.');
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private fail(status: 'disconnected' | 'error', detail: string) {
    const lastReceivedAt = this.connection.lastReceivedAt;
    this.connection = { transport: 'wifi', status, deviceId: this.connection.deviceId, lastReceivedAt, detail };
    this.notify();
  }

  private updateFreshness() {
    const last = this.connection.lastReceivedAt;
    if (!last || this.connection.status === 'error' || this.connection.status === 'disconnected' || this.connection.status === 'unconfigured') return;
    const age = (this.options.now?.() ?? new Date()).getTime() - new Date(last).getTime();
    const nextStatus = age > SENSOR_OFFLINE_AFTER_MS ? 'disconnected' : age > SENSOR_STALE_AFTER_MS ? 'stale' : 'connected';
    if (nextStatus === this.connection.status) return;
    this.connection = { ...this.connection, status: nextStatus, detail: nextStatus === 'connected' ? 'Receiving sensor readings.' : nextStatus === 'stale' ? 'Sensor data is outdated.' : 'No recent response from ESP32.' };
    this.notify();
  }

  listNodes() { return this.repository.listNodes(); }
  listSensors() { return this.repository.listSensors(); }
  latestReadings() { return this.repository.latestReadings(); }
  history(sensorId?: string, limit?: number) { return this.repository.history(sensorId, limit); }
  listHealth() { return this.repository.listHealth(); }
  getCalibration(sensorId: string) { return this.repository.getCalibration(sensorId); }
}

async function validateHealthResponse(response: Response) {
  if (!response.ok) throw new Error(`ESP32 health check returned HTTP ${response.status}.`);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('ESP32 health response is not valid JSON.'); }
  if (!payload || typeof payload !== 'object' || (payload as Record<string, unknown>).status !== 'ok' || typeof (payload as Record<string, unknown>).device_id !== 'string') {
    throw new Error('ESP32 health response is invalid.');
  }
}

export function normalizeBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error('Enter an ESP32 address such as http://192.168.1.50'); }
  if (url.protocol !== 'http:' || !url.hostname || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use the ESP32 local HTTP address only, for example http://192.168.1.50');
  }
  return trimmed;
}
