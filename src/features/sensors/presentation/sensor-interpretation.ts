import type { SensorCalibration, SensorKind } from '@/domain/models';

/** Conservative starter profile for the demo probes. Edit these per sensor after calibration. */
export const SENSOR_STARTER_CALIBRATION = {
  soil: { dryRaw: 3300, wetRaw: 1500 },
  rain: { rainThresholdRaw: 3000, rainActiveWhen: 'below' as const },
} as const;

export type SensorInterpretation = { key: 'soilDry' | 'soilMoist' | 'soilWet' | 'rainNone' | 'rainDetected'; intensity?: 'light' | 'moderate' | 'heavy'; };

export type SensorAlert = { key: 'rainDetected' | 'soilDry' | 'sensorStale' | 'sensorDisconnected'; sensorId: string; position?: string; };

/** One current alert per physical source; callers can merge with persisted advisory alerts. */
export function buildSensorAlerts(readings: { sensorId: string; value?: number; quality: string; receivedAt: string }[], sensors: { id: string; kind: SensorKind; zonePosition?: string }[], connectionStatus: string, now = Date.now(), calibrations: Record<string, SensorCalibration | undefined> = {}): SensorAlert[] {
  const alerts: SensorAlert[] = [];
  for (const sensor of sensors) {
    const reading = readings.filter((item) => item.sensorId === sensor.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
    if (!reading || !Number.isFinite(Date.parse(reading.receivedAt)) || now - Date.parse(reading.receivedAt) > 60_000 || connectionStatus === 'disconnected' || connectionStatus === 'unavailable' || connectionStatus === 'unconfigured' || connectionStatus === 'error') {
      if (sensor.kind !== 'other') alerts.push({ key: 'sensorDisconnected', sensorId: sensor.id, position: sensor.zonePosition });
      continue;
    }
    if (now - Date.parse(reading.receivedAt) > 10_000) { alerts.push({ key: 'sensorStale', sensorId: sensor.id, position: sensor.zonePosition }); continue; }
    if (reading.quality !== 'valid' || reading.value === undefined) continue;
    const interpretation = interpretSensorValue(sensor.kind, reading.value, calibrations[sensor.id]);
    if (interpretation?.key === 'rainDetected') alerts.push({ key: 'rainDetected', sensorId: sensor.id, position: sensor.zonePosition });
    else if (interpretation?.key === 'soilDry') alerts.push({ key: 'soilDry', sensorId: sensor.id, position: sensor.zonePosition });
  }
  return alerts;
}

export function interpretSensorValue(kind: SensorKind, value: number, calibration?: SensorCalibration): SensorInterpretation | undefined {
  if (!Number.isFinite(value)) return undefined;
  if (kind === 'soil_moisture') {
    const dry = calibration?.dryRaw ?? SENSOR_STARTER_CALIBRATION.soil.dryRaw;
    const wet = calibration?.wetRaw ?? SENSOR_STARTER_CALIBRATION.soil.wetRaw;
    if (dry === wet) return undefined;
    const moisture = Math.max(0, Math.min(1, (dry - value) / (dry - wet)));
    return { key: moisture < 0.33 ? 'soilDry' : moisture < 0.67 ? 'soilMoist' : 'soilWet' };
  }
  if (kind === 'rain') {
    const threshold = calibration?.rainThresholdRaw ?? SENSOR_STARTER_CALIBRATION.rain.rainThresholdRaw;
    const activeWhen = calibration?.rainActiveWhen ?? SENSOR_STARTER_CALIBRATION.rain.rainActiveWhen;
    const detected = activeWhen === 'below' ? value < threshold : value > threshold;
    if (!detected) return { key: 'rainNone' };
    const response = Math.max(0, Math.min(1, activeWhen === 'below' ? (threshold - value) / Math.max(1, threshold) : (value - threshold) / Math.max(1, 4095 - threshold)));
    return { key: 'rainDetected', intensity: response < 0.34 ? 'light' : response < 0.67 ? 'moderate' : 'heavy' };
  }
  return undefined;
}
