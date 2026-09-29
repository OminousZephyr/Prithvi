import type { DroneTelemetry, Field, GeoPoint, ObservationDroneContext, ObservationSensorContext, Sensor, SensorReading } from '@/domain/models';
import { isValidGeoPoint, pointInFieldBoundary } from '../scouting/field-geometry.ts';

export const OBSERVATION_SENSOR_STALE_AFTER_MS = 10_000;
export const DRONE_CONTEXT_STALE_AFTER_MS = 30_000;

export function buildSensorContext(sensors: Sensor[], readings: SensorReading[], observedAt: string): ObservationSensorContext | undefined {
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) return undefined;
  const context: ObservationSensorContext = {};
  const latestByKind = new Map<Sensor['kind'], SensorReading>();
  const sensorsById = new Map(sensors.map((sensor) => [sensor.id, sensor]));
  for (const reading of readings) {
    const sensor = sensorsById.get(reading.sensorId);
    if (!sensor || reading.quality !== 'valid' || !Number.isFinite(reading.value) || !Number.isFinite(Date.parse(reading.receivedAt))) continue;
    const previous = latestByKind.get(sensor.kind);
    if (!previous || reading.receivedAt > previous.receivedAt) latestByKind.set(sensor.kind, reading);
  }
  for (const [kind, reading] of latestByKind) {
    const age = Math.max(0, time - Date.parse(reading.receivedAt));
    const measurement = { value: reading.value!, unit: reading.unit, timestamp: reading.observedAt || reading.receivedAt, freshness: age > OBSERVATION_SENSOR_STALE_AFTER_MS ? 'stale' as const : 'current' as const };
    if (kind === 'temperature') context.temperature = measurement;
    if (kind === 'humidity') context.humidity = measurement;
    if (kind === 'soil_moisture') context.soilRaw = measurement;
    if (kind === 'rain') context.rainRaw = measurement;
  }
  return Object.keys(context).length ? context : undefined;
}

export function buildDroneContext(telemetry: DroneTelemetry[], observedAt: string): ObservationDroneContext | undefined {
  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime)) return undefined;
  const latest = telemetry
    .filter((item) => item.source !== 'simulated' && Number.isFinite(Date.parse(item.receivedAt ?? item.observedAt ?? '')) && Date.parse(item.receivedAt ?? item.observedAt ?? '') <= observedTime)
    .sort((a, b) => (b.receivedAt ?? b.observedAt ?? '').localeCompare(a.receivedAt ?? a.observedAt ?? ''))[0];
  if (!latest) return undefined;
  const telemetryTimestamp = latest.receivedAt ?? latest.observedAt ?? latest.timestamp;
  if (latest.connectionState === 'disconnected' || latest.connectionState === 'unknown' || observedTime - Date.parse(telemetryTimestamp) > DRONE_CONTEXT_STALE_AFTER_MS) return undefined;
  const context: ObservationDroneContext = {
    droneId: latest.droneId,
    timestamp: telemetryTimestamp,
    freshness: 'current',
  };
  if (latest.latitude !== null && Number.isFinite(latest.latitude)) context.latitude = latest.latitude;
  if (latest.longitude !== null && Number.isFinite(latest.longitude)) context.longitude = latest.longitude;
  if (latest.altitudeM !== null && Number.isFinite(latest.altitudeM)) context.altitudeM = latest.altitudeM;
  if (latest.headingDegrees !== null && Number.isFinite(latest.headingDegrees)) context.headingDegrees = latest.headingDegrees;
  if (latest.speedMps !== null && Number.isFinite(latest.speedMps)) context.speedMps = latest.speedMps;
  if (latest.batteryPercent !== null && Number.isFinite(latest.batteryPercent)) context.batteryPercent = latest.batteryPercent;
  if (latest.satellites !== null && Number.isFinite(latest.satellites)) context.satellites = latest.satellites;
  if (latest.batteryVoltage !== null && Number.isFinite(latest.batteryVoltage)) context.batteryVoltage = latest.batteryVoltage;
  if (latest.relativeAltitudeM !== null && Number.isFinite(latest.relativeAltitudeM)) context.relativeAltitudeM = latest.relativeAltitudeM;
  if (latest.gpsFix) context.gpsFix = latest.gpsFix;
  if (latest.flightMode) context.flightMode = latest.flightMode;
  if (latest.armed !== null && latest.armed !== undefined) context.armed = latest.armed;
  return context;
}

/** Returns a field only when its recorded polygon actually contains the supplied real fix. */
export function findContainingField(point: GeoPoint, fields: Field[]): Field | undefined {
  if (!isValidGeoPoint(point)) return undefined;
  const matches = fields.filter((field) => pointInFieldBoundary(point, field.boundary));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Explicit farmer field selection wins; otherwise associate by actual polygon containment only. */
export function resolveObservationField(point: GeoPoint | undefined, fields: Field[], selectedFieldId?: string): Field | undefined {
  if (selectedFieldId) {
    const selected = fields.find((field) => field.id === selectedFieldId);
    if (selected) return selected;
  }
  return point ? findContainingField(point, fields) : undefined;
}
