import type { SensorConnection, SensorKind } from '@/domain/models';
import type { SensorProvider } from '@/domain/ports/repositories';
import type { SensorRepository, SensorService, SensorLineTransport } from '@/features/sensors/contracts';
import { JsonLineDecoder, parseEsp32JsonLine } from '@/features/sensors/protocol/esp32-jsonl';

/** Converts transport text to validated, locally timestamped readings and persists them. */
export class SerialSensorProvider implements SensorProvider, SensorService {
  private readonly decoder = new JsonLineDecoder();
  private listeners = new Set<() => void>();
  private unsubscribeTransport?: () => void;
  private unsubscribeConnection?: () => void;
  private starting?: Promise<SensorConnection>;
  private connection: SensorConnection;
  private malformedLineCount = 0;
  private receiveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly transport: SensorLineTransport, private readonly repository: SensorRepository, private readonly now: () => Date = () => new Date()) {
    this.connection = transport.getConnection();
  }

  getConnection() { return this.connection; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }

  start(): Promise<SensorConnection> {
    if (this.unsubscribeTransport) return Promise.resolve(this.connection);
    if (this.starting) return this.starting;
    this.starting = this.open();
    return this.starting.finally(() => { this.starting = undefined; });
  }

  private async open(): Promise<SensorConnection> {
    this.connection = { transport: this.transport.kind, status: 'connecting' };
    this.notify();
    this.unsubscribeConnection = this.transport.subscribeConnection((state) => { this.connection = state; this.notify(); });
    try {
      this.unsubscribeTransport = await this.transport.connect((chunk) => {
        this.receiveQueue = this.receiveQueue.then(() => this.receive(chunk)).catch(() => undefined);
      });
      this.connection = this.transport.getConnection();
    } catch {
      this.connection = this.transport.getConnection();
      if (this.connection.status === 'connecting' || this.connection.status === 'connected') {
        this.connection = { transport: this.transport.kind, status: 'unavailable', detail: 'USB serial support is not connected in this app build.' };
      }
      this.unsubscribeConnection?.(); this.unsubscribeConnection = undefined;
    }
    this.notify();
    return this.connection;
  }

  async stop() {
    this.unsubscribeTransport?.(); this.unsubscribeTransport = undefined;
    this.unsubscribeConnection?.(); this.unsubscribeConnection = undefined;
    try { await this.transport.disconnect(); } catch { /* disconnect failures are reflected as unavailable by the transport */ }
    this.connection = this.transport.getConnection();
    this.notify();
  }

  private async receive(chunk: string) {
    const { lines } = this.decoder.push(chunk);
    for (const line of lines) {
      const parsed = parseEsp32JsonLine(line);
      if (!parsed.ok) { this.malformedLineCount += 1; continue; }
      const frame = parsed.frame;
      const receivedAt = this.now().toISOString();
      const values: Partial<Record<SensorKind, { value?: number; quality: 'valid' | 'invalid'; detail?: string }>> = {};
      for (const kind of ['temperature', 'humidity', 'soil_moisture', 'rain'] as const) {
        const reading = kind === 'temperature' ? frame.temperatureC : kind === 'humidity' ? frame.humidityPct : kind === 'soil_moisture' ? frame.soilRaw : frame.rainRaw;
        values[kind] = { value: reading ?? undefined, quality: frame.fieldQuality[kind].valid ? 'valid' : 'invalid', detail: frame.fieldQuality[kind].detail };
      }
      try {
        await this.repository.saveFrame(frame.deviceId, receivedAt, values);
        this.connection = { transport: this.transport.kind, status: 'connected', deviceId: frame.deviceId, lastReceivedAt: receivedAt,
          detail: this.malformedLineCount ? `${this.malformedLineCount} unreadable serial line(s) ignored` : undefined };
        this.notify();
      } catch {
        this.connection = { transport: this.transport.kind, status: 'error', deviceId: frame.deviceId, lastReceivedAt: this.connection.lastReceivedAt, detail: 'Sensor data could not be saved on this device.' };
        this.notify();
      }
    }
  }

  async listNodes() {
    const nodes = await this.repository.listNodes();
    return this.connection.status === 'disconnected' ? nodes.map((node) => ({ ...node, status: 'offline' as const })) : nodes;
  }
  listSensors() { return this.repository.listSensors(); }
  latestReadings() { return this.repository.latestReadings(); }
  history(sensorId?: string, limit?: number) { return this.repository.history(sensorId, limit); }
  async listHealth() {
    const health = await this.repository.listHealth();
    return this.connection.status === 'disconnected' ? health.map((item) => ({ ...item, status: 'offline' as const, detail: 'USB sensor device is disconnected' })) : health;
  }
  getCalibration(sensorId: string) { return this.repository.getCalibration(sensorId); }
}
