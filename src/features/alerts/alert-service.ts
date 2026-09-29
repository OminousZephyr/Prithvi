import type { Advisory, Alert, AlertPriority, AlertStatus, CropObservation, DroneTelemetry, Field, FlightSession, ScoutingTask, ScoutingZone, Sensor, SensorNode, SensorReading } from '../../domain/models/index.ts';
import { evaluateFieldGeofence } from '../scouting/geofence.ts';
import { isTelemetryFresh, validGpsFix } from '../drone/drone-status.ts';

export interface AlertStore { list<T>(type: string): Promise<T[]>; get?<T>(type: string, id: string): Promise<T | undefined>; save<T extends { id: string }>(type: string, value: T): Promise<T> }
export type AlertConnection = { status: string; deviceId?: string; lastReceivedAt?: string };
export interface AlertServiceOptions { now?: () => Date; sensorStaleAfterMs?: number; telemetryFreshAfterMs?: number; expiryAfterMs?: number }
export interface AlertEvaluationContext {
  now: string; farms?: { id: string; fieldIds: string[] }[]; fields: Field[]; observations: CropObservation[]; zones: ScoutingZone[]; tasks: ScoutingTask[];
  advisories: Advisory[]; sensors: Sensor[]; nodes: SensorNode[]; readings: SensorReading[]; sensorConfigured: boolean; sensorConnection?: AlertConnection;
  sessions: FlightSession[]; telemetry: DroneTelemetry[]; droneConfigured: boolean;
}

export const DEFAULT_SENSOR_ALERT_STALE_MS = 5 * 60_000;
export const DEFAULT_ALERT_EXPIRY_MS = 7 * 24 * 60 * 60_000;
const activeStatuses: AlertStatus[] = ['active', 'acknowledged'];

export function selectHomeAlert(alerts: Alert[]) {
  return alerts.filter((item) => activeStatuses.includes(item.status) && item.priority !== 'low')
    .sort((a, b) => priorityOrder(b.priority) - priorityOrder(a.priority) || b.createdAt.localeCompare(a.createdAt))[0];
}

/** Reconciles local candidates into durable alert history. Repeated evaluation updates one stable record. */
export class AlertService {
  private readonly store: AlertStore;
  private readonly options: AlertServiceOptions;
  private readonly getSensorConnection?: () => AlertConnection;
  private readonly beforeEvaluate?: () => Promise<unknown>;
  constructor(store: AlertStore, options: AlertServiceOptions = {}, getSensorConnection?: () => AlertConnection, beforeEvaluate?: () => Promise<unknown>) { this.store = store; this.options = options; this.getSensorConnection = getSensorConnection; this.beforeEvaluate = beforeEvaluate; }

  async refresh(at = (this.options.now?.() ?? new Date()).toISOString()): Promise<Alert[]> {
    try { await this.beforeEvaluate?.(); } catch { /* an advisory read/evaluation issue must not prevent local alert history from opening */ }
    const context = await this.loadContext(at);
    const old = await this.store.list<Alert>('alert');
    const expired = new Map<string, Alert>(); const nowMs = Date.parse(at);
    for (const item of old) if (activeStatuses.includes(item.status) && item.expiresAt && Date.parse(item.expiresAt) <= nowMs) {
      const updated = { ...item, status: 'expired' as const, updatedAt: at }; await this.store.save('alert', updated); expired.set(item.id, updated);
    }
    const candidates = evaluateAlertCandidates(context, { sensorStaleAfterMs: this.options.sensorStaleAfterMs ?? DEFAULT_SENSOR_ALERT_STALE_MS, telemetryFreshAfterMs: this.options.telemetryFreshAfterMs, expiryAfterMs: this.options.expiryAfterMs ?? DEFAULT_ALERT_EXPIRY_MS });
    const candidateByKey = new Map(candidates.map((item) => [item.dedupeKey, item]));
    for (const baseCandidate of candidates) {
      let candidate = baseCandidate;
      let prior = old.find((item) => item.dedupeKey === candidate.dedupeKey && activeStatuses.includes(item.status))
        ?? old.find((item) => item.dedupeKey.startsWith(`${candidate.dedupeKey}:event:`) && activeStatuses.includes(item.status));
      if (!prior && candidate.type === 'crop_inspection' && candidate.zoneId) {
        const terminal = old.find((item) => item.dedupeKey === candidate.dedupeKey && ['resolved', 'dismissed'].includes(item.status));
        const zone = context.zones.find((item) => item.id === candidate.zoneId);
        const newest = zone?.observationIds.map((id) => context.observations.find((item) => item.id === id)).filter((item): item is CropObservation => !!item).sort((a, b) => Date.parse(b.timestamp ?? b.observedAt) - Date.parse(a.timestamp ?? a.observedAt))[0];
        if (terminal && newest && Date.parse(newest.timestamp ?? newest.observedAt) > Date.parse(terminal.updatedAt)) {
          candidate = { ...candidate, dedupeKey: `${candidate.dedupeKey}:event:${hash(newest.id)}`, id: `alert-${hash(`${candidate.dedupeKey}:event:${newest.id}`)}` };
          prior = old.find((item) => item.dedupeKey === candidate.dedupeKey);
        }
      }
      if (!prior && candidate.dedupeKey === baseCandidate.dedupeKey && old.some((item) => item.dedupeKey === baseCandidate.dedupeKey && ['resolved', 'dismissed', 'expired'].includes(item.status))) continue;
      if (!prior) { await this.store.save('alert', candidate); continue; }
      if (prior.dedupeKey !== candidate.dedupeKey) { candidate = { ...candidate, id: prior.id, dedupeKey: prior.dedupeKey }; candidateByKey.set(prior.dedupeKey, candidate); }
      if (activeStatuses.includes(prior.status) && !expired.has(prior.id)) await this.store.save('alert', { ...prior, ...candidate, id: prior.id, createdAt: prior.createdAt, expiresAt: prior.expiresAt, status: prior.status, updatedAt: at });
    }
    // Close active event alerts when the underlying real condition is no longer present.
    const generatedTypes = new Set<Alert['type']>(['sensor', 'drone', 'geofence', 'crop_inspection']);
    for (const prior of old) {
      if (!activeStatuses.includes(prior.status) || !generatedTypes.has(prior.type) || candidateByKey.has(prior.dedupeKey)) continue;
      const resolved: Alert = { ...prior, status: 'resolved', updatedAt: at }; await this.store.save('alert', resolved);
    }
    return (await this.store.list<Alert>('alert')).map((item) => expired.get(item.id) ?? item).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async list() { return this.refresh(); }
  async setStatus(id: string, status: Extract<AlertStatus, 'acknowledged' | 'dismissed' | 'resolved'>) {
    const current = await this.store.get?.<Alert>('alert', id) ?? (await this.store.list<Alert>('alert')).find((item) => item.id === id);
    if (!current || !activeStatuses.includes(current.status)) return current;
    return this.store.save('alert', { ...current, status, updatedAt: (this.options.now?.() ?? new Date()).toISOString() });
  }

  private async loadContext(now: string): Promise<AlertEvaluationContext> {
    const [farms, fields, observations, zones, tasks, advisories, sensors, nodes, readings, sessions, telemetry, sensorConfig, droneConfig] = await Promise.all([
      this.store.list<{ id: string; fieldIds: string[] }>('farm'), this.store.list<Field>('field'), this.store.list<CropObservation>('crop-observation'),
      this.store.list<ScoutingZone>('scouting-zone'), this.store.list<ScoutingTask>('scouting-task'), this.store.list<Advisory>('advisory'),
      this.store.list<Sensor>('sensor'), this.store.list<SensorNode>('sensor-node'), this.store.list<SensorReading>('sensor-reading'),
      this.store.list<FlightSession>('flight-session'), this.store.list<DroneTelemetry>('drone-telemetry'),
      this.store.get?.<{ baseUrl?: string }>('sensor-config', 'esp32-wifi'), this.store.get?.<{ value?: string }>('app-config', 'drone-telemetry-url'),
    ]);
    return { now, farms, fields, observations, zones, tasks, advisories, sensors, nodes, readings, sessions, telemetry, sensorConfigured: !!sensorConfig?.baseUrl, sensorConnection: this.getSensorConnection?.(), droneConfigured: !!droneConfig?.value };
  }
}

export function evaluateAlertCandidates(context: AlertEvaluationContext, options: Required<Pick<AlertServiceOptions, 'sensorStaleAfterMs' | 'expiryAfterMs'>> & Pick<AlertServiceOptions, 'telemetryFreshAfterMs'>) {
  const result: Alert[] = []; const nowMs = Date.parse(context.now); const expiry = new Date(nowMs + options.expiryAfterMs).toISOString();
  const add = (value: Omit<Alert, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt' | 'syncState'> & { dedupeKey: string }) => {
    const existing = result.find((item) => item.dedupeKey === value.dedupeKey); if (existing) return;
    result.push({ ...value, id: `alert-${hash(value.dedupeKey)}`, createdAt: context.now, updatedAt: context.now, expiresAt: expiry, syncState: 'local' });
  };
  const advisoryByZone = new Map(context.advisories.filter((a) => activeStatuses.includes(a.status) && ['inspection', 'scouting'].includes(a.category)).filter((a) => a.zoneId).map((a) => [a.zoneId!, a]));
  for (const zone of context.zones) {
    if (!['inspection_suggested', 'needs_verification', 'rescan_requested', 'rescan_in_progress', 'rescan_completed', 'evidence_updated', 'verification_pending'].includes(zone.status)) continue;
    const linked = zone.observationIds.map((id) => context.observations.find((obs) => obs.id === id)).filter((item): item is CropObservation => !!item && item.scanStatus === 'possible_issue' && item.source !== 'simulated');
    const advisory = advisoryByZone.get(zone.id);
    if (!linked.length && !advisory) continue;
    const field = context.fields.find((item) => item.id === zone.fieldId);
    const repeated = linked.length > 1;
    const dedupeKey = `crop_inspection:${zone.fieldId}:${zone.id}`;
    add({ farmId: field?.farmId, fieldId: zone.fieldId, zoneId: zone.id, observationId: linked[0]?.id, advisoryId: advisory?.id,
      type: 'crop_inspection', priority: repeated ? 'medium' : advisory?.priority === 'high' ? 'high' : 'medium', title: 'Inspection suggested',
      message: repeated ? `Similar possible crop-health observations were recorded ${linked.length} times in this area.` : advisory?.message ?? 'A possible crop-health issue needs a field check.',
      status: 'active', dedupeKey, source: advisory ? 'advisory' : 'scouting' });
  }
  const zonedObservationIds = new Set(context.zones.flatMap((zone) => zone.observationIds));
  for (const observation of context.observations) {
    if (zonedObservationIds.has(observation.id) || observation.scanStatus !== 'possible_issue' || observation.verificationStatus !== 'requires_verification' || observation.source === 'simulated') continue;
    const field = context.fields.find((item) => item.id === observation.fieldId);
    const advisory = context.advisories.find((item) => activeStatuses.includes(item.status) && item.sourceObservationIds.includes(observation.id) && ['inspection', 'scouting'].includes(item.category));
    if (!advisory && (!Number.isFinite(observation.confidence) || (observation.confidence ?? 0) < 0.65)) continue;
    add({ farmId: field?.farmId ?? observation.farmId, fieldId: observation.fieldId, observationId: observation.id, advisoryId: advisory?.id, type: 'crop_inspection', priority: advisory?.priority === 'high' ? 'high' : 'medium',
      title: 'Inspection suggested', message: advisory?.message ?? 'A possible crop-health issue needs a field check.', status: 'active', dedupeKey: `crop_inspection:${observation.fieldId ?? 'unassigned'}:observation:${observation.id}`, source: advisory ? 'advisory' : 'scouting' });
  }
  addSensorCandidates(context, options.sensorStaleAfterMs, add);
  addDroneCandidates(context, options.telemetryFreshAfterMs, add);
  return result;
}

type CandidateAdder = (value: Omit<Alert, 'id' | 'createdAt' | 'updatedAt' | 'expiresAt' | 'syncState'> & { dedupeKey: string }) => void;
function addSensorCandidates(context: AlertEvaluationContext, staleAfterMs: number, add: CandidateAdder) {
  if (!context.sensorConfigured) return;
  const nodeMap = new Map(context.nodes.map((node) => [node.id, node])); const kindBySensor = new Map(context.sensors.map((sensor) => [sensor.id, sensor.kind]));
  for (const node of context.nodes) {
    const readings = context.readings.filter((reading) => node.sensorIds.includes(reading.sensorId) && reading.quality === 'valid' && Number.isFinite(reading.value)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const latest = readings[0]; const lastSeen = latest?.receivedAt ?? node.lastSeenAt;
    if (!lastSeen || !Number.isFinite(Date.parse(lastSeen)) || Date.parse(context.now) - Date.parse(lastSeen) < staleAfterMs) continue;
    const kinds = new Set(node.sensorIds.map((sensorId) => kindBySensor.get(sensorId)).filter(Boolean));
    for (const kind of kinds) add({ farmId: node.farmId, fieldId: node.fieldId, type: 'sensor', priority: 'low', title: 'Sensor hasn’t reported recently', message: 'Sensor readings are outdated. Check the device before using them for a decision.', status: 'active', dedupeKey: `sensor:${node.id}:${kind}`, source: 'sensor' });
  }
  const lastReceived = context.sensorConnection?.lastReceivedAt;
  if (context.sensorConnection?.status === 'disconnected' && lastReceived && Date.parse(context.now) - Date.parse(lastReceived) >= staleAfterMs) {
    const knownDevice = context.sensorConnection.deviceId ?? context.nodes[0]?.id ?? 'configured-device';
    const node = [...nodeMap.values()].find((item) => item.id === knownDevice);
    add({ farmId: node?.farmId, fieldId: node?.fieldId, type: 'sensor', priority: 'low', title: 'Sensor connection unavailable', message: 'The configured sensor device is not responding. Check its power and local connection.', status: 'active', dedupeKey: `sensor:${knownDevice}:connection`, source: 'sensor' });
  }
}
function addDroneCandidates(context: AlertEvaluationContext, telemetryFreshAfterMs: number | undefined, add: CandidateAdder) {
  if (!context.droneConfigured) return;
  const session = context.sessions.filter((item) => item.status === 'active').sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]; if (!session) return;
  const telemetry = context.telemetry.filter((item) => item.droneId === session.droneId).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const fresh = telemetry && isTelemetryFresh(telemetry, Date.parse(context.now), telemetryFreshAfterMs);
  if (!fresh || telemetry.connectionState === 'disconnected') add({ fieldId: activeInspectionField(context, session), type: 'drone', priority: 'low', title: 'Drone telemetry unavailable', message: 'Telemetry stopped during an active flight. Check the bridge before continuing the inspection.', status: 'active', dedupeKey: `drone:${session.id}:connection`, source: 'drone' });
  else if (telemetry.connectionState === 'connected' && !validGpsFix(telemetry.gpsFix)) add({ fieldId: activeInspectionField(context, session), type: 'drone', priority: 'low', title: 'Drone GPS is unavailable', message: 'A valid GPS fix is not available during this inspection.', status: 'active', dedupeKey: `drone:${session.id}:gps`, source: 'drone' });
  const fieldId = activeInspectionField(context, session); const field = context.fields.find((item) => item.id === fieldId);
  if (fresh && telemetry.connectionState === 'connected' && field?.boundary && Number.isFinite(telemetry.latitude) && Number.isFinite(telemetry.longitude) && validGpsFix(telemetry.gpsFix) && evaluateFieldGeofence(field.boundary, { latitude: telemetry.latitude!, longitude: telemetry.longitude! }) === 'outside') {
    add({ farmId: field.farmId, fieldId: field.id, type: 'geofence', priority: 'medium', title: 'Drone is outside this field', message: 'The current GPS point is outside the selected field boundary. This is informational only.', status: 'active', dedupeKey: `geofence:${session.id}:${field.id}`, source: 'geofence' });
  }
}
function activeInspectionField(context: AlertEvaluationContext, session: FlightSession) {
  const task = context.tasks.find((item) => ['rescan_requested', 'rescan_in_progress', 'targeted_rescan_requested'].includes(item.status));
  return task?.fieldId ?? context.observations.find((item) => item.flightSessionId === session.id)?.fieldId;
}
function hash(value: string) { let h = 2166136261; for (const char of value) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function priorityOrder(priority: AlertPriority) { return priority === 'high' ? 3 : priority === 'medium' ? 2 : 1; }
