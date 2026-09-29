import type { Sensor, SensorCalibration, SensorHealth, SensorKind, SensorNode, SensorReading } from '@/domain/models';
import type { SensorRepository } from '@/features/sensors/contracts';

export const SENSOR_STALE_AFTER_MS = 10_000;
export const SENSOR_OFFLINE_AFTER_MS = 60_000;

const READING = 'sensor-reading';
const NODE = 'sensor-node';
const SENSOR = 'sensor';
const HEALTH = 'sensor-health';
const CALIBRATION = 'sensor-calibration';

export interface SensorEntityStore {
  list<T>(type: string): Promise<T[]>;
  get<T>(type: string, id: string): Promise<T | undefined>;
  save<T extends { id: string }>(type: string, value: T): Promise<T>;
}

const sensorDefinitions: Record<Exclude<SensorKind, 'other'>, Pick<Sensor, 'label' | 'unit'>> = {
  temperature: { label: 'Temperature', unit: '°C' },
  humidity: { label: 'Humidity', unit: '% RH' },
  soil_moisture: { label: 'Soil moisture (raw)', unit: 'ADC count' },
  rain: { label: 'Rain sensor (raw)', unit: 'ADC count' },
};

function latestFirst(a: SensorReading, b: SensorReading) { return b.receivedAt.localeCompare(a.receivedAt); }

export function createSensorRepository(store: SensorEntityStore): SensorRepository {
  return {
    async listNodes() {
      const nodes = await store.list<SensorNode>(NODE);
      const now = Date.now();
      return nodes.map((node) => {
        const age = node.lastSeenAt ? now - new Date(node.lastSeenAt).getTime() : Infinity;
        const status: SensorNode['status'] = age <= SENSOR_STALE_AFTER_MS ? 'online' : age <= SENSOR_OFFLINE_AFTER_MS ? 'stale' : 'offline';
        return { ...node, status };
      });
    },
    async listSensors(nodeId) {
      const sensors = await store.list<Sensor>(SENSOR);
      return nodeId ? sensors.filter((sensor) => sensor.nodeId === nodeId) : sensors;
    },
    async history(sensorId, limit = 200) {
      const all = (await store.list<SensorReading>(READING)).sort(latestFirst);
      return all.filter((reading) => !sensorId || reading.sensorId === sensorId).slice(0, Math.max(0, limit));
    },
    async latestReadings() {
      const seen = new Set<string>();
      const latest: SensorReading[] = [];
      for (const reading of await this.history(undefined, Number.MAX_SAFE_INTEGER)) {
        if (!seen.has(reading.sensorId)) { latest.push(reading); seen.add(reading.sensorId); }
      }
      return latest;
    },
    async listHealth() {
      const [sensors, readings, calibrations] = await Promise.all([
        this.listSensors(), this.latestReadings(), store.list<SensorCalibration>(CALIBRATION),
      ]);
      const now = Date.now();
      return sensors.map((sensor): SensorHealth => {
        const reading = readings.find((item) => item.sensorId === sensor.id);
        const calibration = calibrations.find((item) => item.sensorId === sensor.id);
        let status: SensorHealth['status'] = 'unknown';
        let detail = 'No valid reading received';
        if (reading) {
          const age = now - new Date(reading.receivedAt).getTime();
          if (age > SENSOR_OFFLINE_AFTER_MS) { status = 'offline'; detail = 'No recent data received'; }
          else if (age > SENSOR_STALE_AFTER_MS) { status = 'stale'; detail = 'Last reading is outdated'; }
          else if (reading.quality !== 'valid') { status = 'unknown'; detail = reading.qualityDetail ?? 'Device reported this reading unavailable'; }
          else { status = 'healthy'; detail = 'Recent reading received'; }
        }
        if (sensor.kind === 'soil_moisture' && (calibration?.dryRaw === undefined || calibration.wetRaw === undefined)) {
          status = reading?.quality === 'valid' ? 'uncalibrated' : status;
          if (reading?.quality === 'valid') detail = 'Calibration is required before interpreting moisture';
        }
        if (sensor.kind === 'rain' && calibration?.rainThresholdRaw === undefined && reading?.quality === 'valid') {
          status = 'uncalibrated'; detail = 'Rain threshold configuration is required';
        }
        return { sensorId: sensor.id, status, checkedAt: new Date(now).toISOString(), detail };
      });
    },
    async getCalibration(sensorId) { return store.get<SensorCalibration>(CALIBRATION, sensorId); },
    async saveCalibration(calibration) { await store.save(CALIBRATION, { ...calibration, id: calibration.sensorId }); },
    async saveFrame(deviceId, receivedAt, values, deviceTimestamp, source = 'device') {
      const sensorIds = (Object.keys(sensorDefinitions) as (keyof typeof sensorDefinitions)[]).map((kind) => `${deviceId}:${kind}`);
      const previous = await store.get<SensorNode>(NODE, deviceId);
      const node: SensorNode = {
        ...previous, id: deviceId, name: deviceId, hardware: 'ESP32 DevKit V1', status: 'online', lastSeenAt: receivedAt,
        sensorIds,
      };
      await store.save(NODE, node);
      for (const kind of Object.keys(sensorDefinitions) as (keyof typeof sensorDefinitions)[]) {
        const definition = sensorDefinitions[kind];
        const sensorId = `${deviceId}:${kind}`;
        const existing = await store.get<Sensor>(SENSOR, sensorId);
        const sensor: Sensor = { ...existing, id: sensorId, nodeId: deviceId, kind, ...definition };
        await store.save(SENSOR, sensor);
        const incoming = values[kind];
        const reading: SensorReading = {
          id: `${sensorId}:${receivedAt}`, sensorId, deviceId, hubId: deviceId, fieldId: node.fieldId, zonePosition: existing?.zonePosition,
          value: incoming?.value, unit: definition.unit, observedAt: receivedAt, receivedAt, deviceTimestamp,
          source, quality: incoming?.quality ?? 'invalid', qualityDetail: incoming?.detail ?? 'Reading missing from device message', syncState: 'pending',
        };
        await store.save(READING, reading);
        const health: SensorHealth = { sensorId, status: incoming?.quality === 'valid' ? 'healthy' : 'unknown', checkedAt: receivedAt, detail: incoming?.detail };
        await store.save(HEALTH, { ...health, id: sensorId });
      }
    },
  };
}
