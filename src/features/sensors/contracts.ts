import type { DataSource, Sensor, SensorCalibration, SensorConnection, SensorHealth, SensorKind, SensorNode, SensorReading } from '@/domain/models';

export interface SensorRepository {
  listNodes(): Promise<SensorNode[]>;
  listSensors(nodeId?: string): Promise<Sensor[]>;
  latestReadings(): Promise<SensorReading[]>;
  history(sensorId?: string, limit?: number): Promise<SensorReading[]>;
  listHealth(): Promise<SensorHealth[]>;
  getCalibration(sensorId: string): Promise<SensorCalibration | undefined>;
  saveCalibration(calibration: SensorCalibration): Promise<void>;
  saveFrame(deviceId: string, receivedAt: string, values: Partial<Record<SensorKind, { value?: number; quality: SensorReading['quality']; detail?: string }>>, deviceTimestamp?: string | number | null, source?: DataSource): Promise<void>;
}

export interface SensorLineTransport {
  readonly kind: 'usb-serial' | 'wifi';
  connect(onChunk: (chunk: string) => void): Promise<() => void>;
  subscribeConnection(listener: (connection: SensorConnection) => void): () => void;
  disconnect(): Promise<void>;
  getConnection(): SensorConnection;
}

export interface SensorService {
  getConnection(): SensorConnection;
  start(): Promise<SensorConnection>;
  stop(): Promise<void>;
  subscribe(listener: () => void): () => void;
  getCalibration(sensorId: string): Promise<SensorCalibration | undefined>;
  history(sensorId?: string, limit?: number): Promise<SensorReading[]>;
}

export { SENSOR_OFFLINE_AFTER_MS, SENSOR_STALE_AFTER_MS } from '@/features/sensors/sensor-repository-core';
