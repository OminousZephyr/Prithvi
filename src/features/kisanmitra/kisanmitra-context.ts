import type { Field, Farm } from '@/domain/models';
import type { KisanContext } from './kisanmitra-types';
import type { FieldWeather } from '@/features/weather/weather-types';

export interface KisanDataSource {
  getFarm(id: string): Promise<Farm | undefined>; listFarms(): Promise<Farm[]>; listFields(farmId?: string): Promise<Field[]>;
  listObservations(query?: { farmId?: string; fieldId?: string }): Promise<import('@/domain/models').CropObservation[]>;
  listEvidence(fieldId?: string): Promise<import('@/domain/models').ScoutingEvidence[]>;
  listAdvisories(): Promise<import('@/domain/models').Advisory[]>; listAlerts(): Promise<import('@/domain/models').Alert[]>;
  listSensors(): Promise<import('@/domain/models').Sensor[]>; listNodes?(): Promise<import('@/domain/models').SensorNode[]>; latestReadings(): Promise<import('@/domain/models').SensorReading[]>;
}

export async function buildKisanContext(data: KisanDataSource, fieldId: string | undefined, language: 'en' | 'hi', weather?: FieldWeather): Promise<KisanContext> {
  const [farms, fields] = await Promise.all([data.listFarms(), data.listFields()]);
  const field = fields.find((item) => item.id === fieldId);
  const farm = field ? farms.find((item) => item.id === field.farmId) : farms.find((item) => item.isActive) ?? (farms.length === 1 ? farms[0] : undefined);
  const [observations, evidence, advisories, alerts, sensors, nodes, readings] = await Promise.all([
    data.listObservations(field ? { farmId: farm?.id, fieldId: field.id } : { farmId: farm?.id }),
    field ? data.listEvidence(field.id) : Promise.resolve([]), data.listAdvisories(), data.listAlerts(), data.listSensors(), data.listNodes?.() ?? Promise.resolve([]), data.latestReadings(),
  ]);
  const fieldScope = (item: { fieldId?: string }) => !field || item.fieldId === field.id;
  const farmFieldIds = new Set(fields.filter((item) => item.farmId === farm?.id).map((item) => item.id));
  const sensorKind = new Map(sensors.map((sensor) => [sensor.id, sensor.kind]));
  const nodeBySensor = new Map(sensors.map((sensor) => [sensor.id, nodes.find((node) => node.id === sensor.nodeId)]));
  const latest = new Map<string, typeof readings[number]>();
  for (const reading of readings.filter((item) => item.quality === 'valid' && typeof item.value === 'number' && (field ? nodeBySensor.get(item.sensorId)?.fieldId === field.id : !!farm && farmFieldIds.has(nodeBySensor.get(item.sensorId)?.fieldId ?? '')))) {
    const kind = sensorKind.get(reading.sensorId); if (!kind) continue;
    const old = latest.get(kind); if (!old || reading.receivedAt > old.receivedAt) latest.set(kind, reading);
  }
  const scopedObservations = observations.filter((item) => fieldScope(item)).sort((a, b) => (b.timestamp ?? b.observedAt).localeCompare(a.timestamp ?? a.observedAt)).slice(0, 12);
  return {
    farm: farm ? { id: farm.id, name: farm.name, location: farm.location } : undefined,
    field: field ? { id: field.id, name: field.name, crop: field.crop?.name, variety: field.crop?.variety, growthStage: field.crop?.growthStage } : undefined,
    recentObservations: scopedObservations.map((item) => ({ id: item.id, timestamp: item.timestamp ?? item.observedAt, crop: item.crop, condition: item.condition, status: item.scanStatus, confidence: item.confidence, source: item.source })),
    scoutingEvidence: evidence.filter((item) => item.status !== 'dismissed').slice(0, 10).map((item) => ({ id: item.id, observationCount: item.observationCount, crop: item.crop, condition: item.condition, evidenceLevel: item.evidenceLevel, status: item.status })),
    activeAdvisories: advisories.filter((item) => ['active', 'acknowledged'].includes(item.status) && (field ? item.fieldId === field.id : !!farm && (!item.fieldId || farmFieldIds.has(item.fieldId)))).slice(0, 10).map(({ id, category, title, message, action, priority }) => ({ id, category, title, message, action, priority })),
    activeAlerts: alerts.filter((item) => ['active', 'acknowledged'].includes(item.status) && (field ? item.fieldId === field.id : !!farm && (!item.fieldId || farmFieldIds.has(item.fieldId)))).slice(0, 10).map(({ id, type, title, message, priority, fieldId: alertFieldId }) => ({ id, type, title, message, priority, fieldId: alertFieldId })),
    sensorReadings: [...latest.entries()].map(([kind, item]) => ({ kind, value: item.value!, unit: item.unit, observedAt: item.receivedAt, quality: item.quality })),
    weather: weather ? { fetchedAt: weather.fetchedAt, current: weather.current, nextDays: weather.days.map(({ date, minC, maxC, precipitationProbability, precipitationMm, condition }) => ({ date, minC, maxC, precipitationProbability, precipitationMm, condition })) } : undefined,
    recentCropPrices: [], language,
  };
}
