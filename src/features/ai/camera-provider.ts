import type { CameraCapture, LocalServiceState } from './ai-types.ts';
import { normalizeLocalServiceUrl } from './local-service-config.ts';

type CameraConfig = { id: string; baseUrl: string };
export interface CameraStatus {
  status: 'ok';
  cameraInitialized: true;
  deviceId: string;
  camera: string;
  sensor: string;
  sensorPid: string;
  format: string;
  width: number;
  height: number;
  wifi: { connected: boolean; ip: string };
}
interface CameraConfigStore { get<T>(type: string, id: string): Promise<T | undefined>; save<T extends { id: string }>(type: string, value: T): Promise<T> }
const CONFIG_TYPE = 'local-service-config';
const CONFIG_ID = 'esp32-cam';

export class LocalEsp32CameraProvider {
  private readonly store: CameraConfigStore;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private baseUrl?: string;
  private state: LocalServiceState = 'unconfigured';

  constructor(store: CameraConfigStore, fetcher: typeof fetch = fetch, timeoutMs = 10_000) { this.store = store; this.fetcher = fetcher; this.timeoutMs = timeoutMs; }

  getState() { return this.state; }

  async getConfiguredBaseUrl() {
    if (this.baseUrl) return this.baseUrl;
    try { this.baseUrl = (await this.store.get<CameraConfig>(CONFIG_TYPE, CONFIG_ID))?.baseUrl; } catch { /* report as unconfigured */ }
    return this.baseUrl;
  }

  async configureBaseUrl(value: string) {
    const baseUrl = normalizeLocalServiceUrl(value, 'ESP32-CAM');
    await this.store.save(CONFIG_TYPE, { id: CONFIG_ID, baseUrl });
    this.baseUrl = baseUrl;
    this.state = 'connecting';
    return baseUrl;
  }

  async checkStatus() {
    const baseUrl = await this.getConfiguredBaseUrl();
    if (!baseUrl) { this.state = 'unconfigured'; return { connected: false, detail: 'Camera address is not configured.' }; }
    this.state = 'connecting';
    try {
      const response = await this.request(`${baseUrl}/camera-status`);
      if (!response.ok) throw new Error(`Camera returned HTTP ${response.status}.`);
      const body = parseCameraStatus(await response.json());
      if (!body) throw new Error('Camera status response is invalid.');
      this.state = 'connected';
      return { connected: true, detail: 'ESP32-CAM is reachable.', camera: body };
    } catch (error) {
      this.state = 'unreachable';
      return { connected: false, detail: error instanceof Error ? error.message : 'ESP32-CAM is unreachable.' };
    }
  }

  async capture(): Promise<CameraCapture> {
    const baseUrl = await this.getConfiguredBaseUrl();
    if (!baseUrl) { this.state = 'unconfigured'; throw new Error('Set the ESP32-CAM address in Settings first.'); }
    this.state = 'connecting';
    try {
      const response = await this.request(`${baseUrl}/capture`);
      if (!response.ok) throw new Error(`ESP32-CAM returned HTTP ${response.status}.`);
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('image/jpeg')) throw new Error('Camera response was not a JPEG image.');
      const imageBlob = await response.blob();
      if (!imageBlob.size) throw new Error('Camera returned an empty image.');
      const imageUri = await blobToDataUrl(imageBlob);
      this.state = 'connected';
      return { imageUri, imageBlob, capturedAt: new Date().toISOString() };
    } catch (error) {
      this.state = 'unreachable';
      throw error;
    }
  }

  private async request(url: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try { return await this.fetcher(url, { method: 'GET', headers: { Accept: 'application/json, image/jpeg' }, signal: controller.signal }); }
    catch { throw new Error(controller.signal.aborted ? 'ESP32-CAM request timed out.' : 'ESP32-CAM is unreachable on this local network.'); }
    finally { clearTimeout(timer); }
  }
}

export function parseCameraStatus(value: unknown): CameraStatus | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const body = value as Record<string, unknown>;
  const wifi = body.wifi as Record<string, unknown> | undefined;
  if (body.status !== 'ok' || body.camera_initialized !== true ||
      typeof body.device_id !== 'string' || typeof body.camera !== 'string' ||
      typeof body.sensor !== 'string' || typeof body.sensor_pid !== 'string' ||
      typeof body.format !== 'string' || !Number.isInteger(body.width) || !Number.isInteger(body.height) ||
      !wifi || typeof wifi.connected !== 'boolean' || typeof wifi.ip !== 'string') return undefined;
  return {
    status: 'ok', cameraInitialized: true, deviceId: body.device_id, camera: body.camera,
    sensor: body.sensor, sensorPid: body.sensor_pid, format: body.format,
    width: body.width as number, height: body.height as number,
    wifi: { connected: wifi.connected, ip: wifi.ip },
  };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not prepare the camera image preview.'));
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Camera image preview is unavailable.'));
    reader.readAsDataURL(blob);
  });
}
