import type { SensorConnection, SensorKind, SensorReading } from '@/domain/models';
import { SENSOR_OFFLINE_AFTER_MS, SENSOR_STALE_AFTER_MS } from '../sensor-repository-core.ts';

export type SensorCardKind = Exclude<SensorKind, 'other'>;
export type SensorCardState = 'live' | 'stale' | 'unavailable' | 'disconnected';
export interface SensorCardValue {
  kind: SensorCardKind;
  sensorId?: string;
  position?: string;
  value?: number;
  state: SensorCardState;
  receivedAt?: string;
  raw: boolean;
}

/** Merge each packet without letting an out-of-order refresh replace newer real data. */
export function mergeSensorReadings(previous: SensorReading[], incoming: SensorReading[]): SensorReading[] {
  const bySensor = new Map<string, SensorReading[]>();
  for (const item of [...previous, ...incoming]) {
    const rows = bySensor.get(item.sensorId) ?? [];
    if (!rows.some((row) => row.id === item.id)) rows.push(item);
    bySensor.set(item.sensorId, rows);
  }
  return [...bySensor.values()].flatMap((rows) => {
    rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const newest = rows[0];
    const lastValid = rows.find((item) => item.quality === 'valid' && item.value !== undefined && (item.source === 'device' || item.source === 'device_wifi'));
    return lastValid && lastValid.id !== newest.id ? [newest, lastValid] : [newest];
  });
}

const SENSOR_KINDS: SensorCardKind[] = ['temperature', 'humidity', 'soil_moisture', 'rain'];

/** Builds UI-ready values from persisted readings. It never infers soil or rain semantics. */
export function buildSensorGrid(readings: SensorReading[], sensors: { id: string; kind: SensorKind; zonePosition?: string }[], connection: SensorConnection, now = Date.now()): SensorCardValue[] {
  return SENSOR_KINDS.flatMap((kind) => {
    const sources = sensors.filter((item) => item.kind === kind);
    // Keep same-kind sensors separate: a field may have this sensor in several zones.
    return (sources.length ? sources : [undefined]).map((sensor) => {
    const sourceReadings = sensor ? readings.filter((item) => item.sensorId === sensor.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)) : [];
    const latest = sourceReadings[0];
    const reading = sourceReadings.find((item) => item.quality === 'valid' && item.value !== undefined && Number.isFinite(item.value) && (item.source === 'device' || item.source === 'device_wifi') && Number.isFinite(Date.parse(item.receivedAt)) && Date.parse(item.receivedAt) <= now);
    const parsedAt = reading ? Date.parse(reading.receivedAt) : NaN;
    const valid = Boolean(reading);
    const age = reading && Number.isFinite(parsedAt) ? now - parsedAt : Infinity;
    const disconnected = ['disconnected', 'error'].includes(connection.status) || Boolean(reading && age > SENSOR_OFFLINE_AFTER_MS);
    const unavailable = ['unconfigured', 'unavailable'].includes(connection.status) && !reading;
    const stale = connection.status === 'stale' || connection.status === 'connecting' || age > SENSOR_STALE_AFTER_MS || Boolean(latest && reading && latest.id !== reading.id);
    const state: SensorCardState = unavailable || !reading || !valid ? 'unavailable' : disconnected ? 'disconnected' : stale ? 'stale' : 'live';
    // Keep the last real value visible during reconnects; its state and timestamp make freshness clear.
    return { kind, sensorId: sensor?.id, position: reading?.zonePosition ?? sensor?.zonePosition, value: valid ? reading!.value : undefined, state, receivedAt: reading?.receivedAt, raw: kind === 'soil_moisture' || kind === 'rain' };
    });
  });
}

/** Home summary includes only fresh, valid, real readings; ADC values stay explicitly raw. */
export function buildHomeSensorSummary(readings: SensorReading[], sensors: { id: string; kind: SensorKind }[], connection: SensorConnection, now = Date.now(), labels: { humidity?: string; soil?: string; rain?: string; raw?: string; stale?: string; disconnected?: string } = {}): string | undefined {
  const live = buildSensorGrid(readings, sensors, connection, now).filter((item) => item.value !== undefined && item.state !== 'unavailable');
  const parts = live.slice(0, 2).map((item) => {
    const value = item.kind === 'temperature' ? `${Math.round(item.value!)}°C` : item.kind === 'humidity' ? `${Math.round(item.value!)}% ${labels.humidity ?? 'humidity'}` : `${item.kind === 'soil_moisture' ? labels.soil ?? 'Soil' : labels.rain ?? 'Rain'} ${item.value} · ${labels.raw ?? 'raw'}`;
    return `${value}${item.state === 'stale' ? ` · ${labels.stale ?? 'stale'}` : item.state === 'disconnected' ? ` · ${labels.disconnected ?? 'disconnected'}` : ''}`;
  });
  return parts.length ? parts.join(' · ') : undefined;
}
