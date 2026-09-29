import type { DroneTelemetry, GPSFixQuality } from '@/domain/models';

export class TelemetryParseError extends Error { constructor(message = 'Telemetry response is invalid.') { super(message); this.name = 'TelemetryParseError'; } }

export function parseTelemetryJson(input: unknown, receivedAt = new Date().toISOString()): DroneTelemetry {
  const value = typeof input === 'string' ? parseJson(input) : input;
  if (!isRecord(value)) throw new TelemetryParseError();
  const droneId = typeof value.drone_id === 'string' ? value.drone_id.trim() : '';
  if (!droneId) throw new TelemetryParseError('Telemetry is missing a drone ID.');
  const fixCode = nullableInteger(value.gps_fix, 0, 6);
  const gpsFix = gpsFixFromCode(fixCode);
  const coords = validCoordinates(value.latitude, value.longitude);
  const connectionState = value.connection === 'connected' ? 'connected' : value.connection === 'disconnected' ? 'disconnected' : 'unknown';
  const timestamp = receivedAt;
  return {
    id: `${droneId}:${timestamp}`, droneId, timestamp, receivedAt,
    deviceTimestamp: nullableDeviceTime(value.timestamp),
    latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
    altitudeM: nullableFinite(value.altitude), relativeAltitudeM: nullableFinite(value.relative_altitude),
    speedMps: nullableFinite(value.ground_speed), headingDegrees: normalizeHeading(nullableFinite(value.heading)),
    batteryVoltage: nullableFinite(value.battery_voltage), batteryPercent: nullableRange(value.battery_percent, 0, 100),
    satellites: nullableInteger(value.satellites, 0, 255), armed: typeof value.armed === 'boolean' ? value.armed : null,
    flightMode: typeof value.flight_mode === 'string' && value.flight_mode.trim() ? value.flight_mode.trim() : null,
    gpsFix, gpsFixCode: fixCode, connectionState, source: 'device_wifi', syncState: 'local', observedAt: timestamp,
  };
}

export function gpsFixFromCode(code: number | null): GPSFixQuality {
  if (code === null || code === 0 || code === 1) return code === null ? 'unknown' : 'no_fix';
  if (code === 2) return '2d';
  if (code === 3) return '3d';
  if (code === 4) return 'dgps';
  if (code === 5) return 'rtk_float';
  if (code === 6) return 'rtk_fixed';
  return 'unknown';
}

function parseJson(value: string) { try { return JSON.parse(value) as unknown; } catch { throw new TelemetryParseError('Telemetry response is not valid JSON.'); } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nullableFinite(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function nullableRange(value: unknown, min: number, max: number): number | null { const n = nullableFinite(value); return n !== null && n >= min && n <= max ? n : null; }
function nullableInteger(value: unknown, min: number, max: number): number | null { const n = nullableRange(value, min, max); return n !== null && Number.isInteger(n) ? n : null; }
function nullableDeviceTime(value: unknown): string | number | null { return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : null; }
function normalizeHeading(value: number | null): number | null { return value === null || value < 0 || value > 360 ? null : value === 360 ? 0 : value; }
function validCoordinates(latitude: unknown, longitude: unknown) {
  const lat = nullableRange(latitude, -90, 90); const lon = nullableRange(longitude, -180, 180);
  return lat === null || lon === null ? undefined : { latitude: lat, longitude: lon };
}

export interface MavlinkMessage { type: 'HEARTBEAT' | 'GLOBAL_POSITION_INT' | 'GPS_RAW_INT' | 'SYS_STATUS' | 'VFR_HUD' | 'ATTITUDE'; [key: string]: unknown }
export type PartialTelemetry = Partial<Omit<DroneTelemetry, 'id' | 'droneId' | 'timestamp' | 'receivedAt' | 'deviceTimestamp' | 'source' | 'syncState' | 'observedAt'>>;

/** Maps parsed MAVLink fields to display telemetry only; it has no command/send API. */
export function mapMavlinkMessage(message: MavlinkMessage): PartialTelemetry {
  switch (message.type) {
    case 'HEARTBEAT': return { armed: typeof message.base_mode === 'number' ? (message.base_mode & 128) !== 0 : null, flightMode: typeof message.flight_mode === 'string' ? message.flight_mode : null };
    case 'GLOBAL_POSITION_INT': {
      const point = validCoordinates(scaledCoordinate(message.lat), scaledCoordinate(message.lon));
      return { latitude: point?.latitude ?? null, longitude: point?.longitude ?? null, altitudeM: scaled(message.alt, 1000), relativeAltitudeM: scaled(message.relative_alt, 1000), speedMps: vectorSpeed(message.vx, message.vy), headingDegrees: scaledHeading(message.hdg) };
    }
    case 'GPS_RAW_INT': {
      const point = validCoordinates(scaledCoordinate(message.lat), scaledCoordinate(message.lon));
      const fix = nullableInteger(message.fix_type, 0, 6);
      return { latitude: point?.latitude ?? null, longitude: point?.longitude ?? null, gpsFixCode: fix, gpsFix: gpsFixFromCode(fix), satellites: nullableInteger(message.satellites_visible, 0, 255) };
    }
    case 'SYS_STATUS': return { batteryVoltage: scaled(message.voltage_battery, 1000), batteryPercent: nullableRange(message.battery_remaining, 0, 100) };
    case 'VFR_HUD': return { speedMps: nullableFinite(message.groundspeed), headingDegrees: normalizeHeading(nullableFinite(message.heading)), altitudeM: nullableFinite(message.alt) };
    case 'ATTITUDE': return {};
  }
}
function scaled(value: unknown, divisor: number): number | null { const n = nullableFinite(value); return n === null || n < 0 ? null : n / divisor; }
function scaledCoordinate(value: unknown): number | null { const n = nullableFinite(value); return n === null ? null : n / 1e7; }
function scaledHeading(value: unknown): number | null { const n = nullableFinite(value); return n === null || n === 65535 ? null : normalizeHeading(n / 100); }
function vectorSpeed(vx: unknown, vy: unknown): number | null { const x = nullableFinite(vx); const y = nullableFinite(vy); return x === null || y === null ? null : Math.hypot(x, y) / 100; }

export class MavlinkTelemetryAccumulator {
  private fields: PartialTelemetry = {};
  update(message: MavlinkMessage) { this.fields = { ...this.fields, ...mapMavlinkMessage(message) }; return { ...this.fields }; }
  snapshot() { return { ...this.fields }; }
}
