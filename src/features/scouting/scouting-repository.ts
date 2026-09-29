import type { CropObservation, Field, GeoPoint, MapObservation, ScoutingEvidence, ScoutingTask, ScoutingTaskStatus, ScoutingZone } from '@/domain/models';
import type { DroneRepository } from '@/features/drone/drone-repository.ts';
import { toMapObservations } from './observation-markers.ts';
import { isValidGeoPoint } from './field-geometry.ts';
import { isTelemetryFresh } from '../drone/drone-status.ts';
import { DEFAULT_SCOUTING_EVIDENCE_OPTIONS, ScoutingEvidenceService, type ScoutingEvidenceOptions } from './scouting-evidence.ts';
import { evaluateZoneInspectionAlert } from '../observations/inspection-alert-evaluator.ts';

export interface ScoutingStore { list<T>(type: string): Promise<T[]>; get?<T>(type: string, id: string): Promise<T | undefined>; save<T extends { id: string }>(type: string, value: T): Promise<T> }
export const SCOUTING_ZONE_RADIUS_METERS = 50;
export const SCOUTING_MIN_CONFIDENCE = 0.65;
export class ScoutingRepository {
  private readonly store: ScoutingStore;
  private readonly droneRepository?: DroneRepository;
  readonly evidenceService: ScoutingEvidenceService;
  private readonly evidenceOptions: ScoutingEvidenceOptions;
  constructor(store: ScoutingStore, droneRepository?: DroneRepository, evidenceOptions = DEFAULT_SCOUTING_EVIDENCE_OPTIONS) { this.store = store; this.droneRepository = droneRepository; this.evidenceOptions = evidenceOptions; this.evidenceService = new ScoutingEvidenceService(store, evidenceOptions); }
  async getMapData(fieldId: string) {
    const [field, observations, sessions] = await Promise.all([this.store.get?.<Field>('field', fieldId), this.store.list<CropObservation>('crop-observation'), this.droneRepository?.listSessions() ?? Promise.resolve([])]);
    const fieldObservations = observations.filter((item) => item.fieldId === fieldId);
    const markers = toMapObservations(fieldObservations, fieldId);
    const session = sessions.find((item) => item.droneId && fieldObservations.some((obs) => obs.flightSessionId === item.id));
    const track = session ? await this.droneRepository?.getTrack(session.id) ?? [] : [];
    const currentTelemetry = await this.droneRepository?.getLatestTelemetry();
    const currentPoint = currentTelemetry ? validPoint(currentTelemetry.latitude, currentTelemetry.longitude) : undefined;
    const dronePosition = currentTelemetry && currentPoint && currentTelemetry.connectionState === 'connected' && isTelemetryFresh(currentTelemetry) && validFix(currentTelemetry.gpsFix)
      ? { ...currentPoint, heading: currentTelemetry.headingDegrees ?? undefined, altitudeM: currentTelemetry.altitudeM ?? undefined, timestamp: currentTelemetry.receivedAt } : undefined;
    const zones = await this.getZones(fieldId);
    const droneTelemetryState = !currentTelemetry ? 'unavailable' as const : !isTelemetryFresh(currentTelemetry) ? 'stale' as const : currentTelemetry.connectionState === 'disconnected' ? 'disconnected' as const : currentTelemetry.connectionState !== 'connected' ? 'unavailable' as const : validFix(currentTelemetry.gpsFix) ? 'connected' as const : 'no_gps_fix' as const;
    return { field, observations: markers, zones, track: track.map(({ latitude, longitude, timestamp }) => ({ latitude, longitude, timestamp })), dronePosition, droneTelemetryState, session };
  }
  async getZones(fieldId?: string) {
    const [observations, existing] = await Promise.all([this.store.list<CropObservation>('crop-observation'), this.store.list<ScoutingZone>('scouting-zone')]);
    const nowMs = Date.now();
    const eligible = observations.filter((item) => item.imageQuality === 'acceptable' && Number.isFinite(Date.parse(item.timestamp ?? item.observedAt)) && nowMs - Date.parse(item.timestamp ?? item.observedAt) >= 0 && nowMs - Date.parse(item.timestamp ?? item.observedAt) <= this.evidenceOptions.windowMs);
    const clusters = groupNearby(toMapObservations(eligible, fieldId).filter((item) => isZoneEligible(item, this.evidenceOptions.minimumConfidence)), this.evidenceOptions.radiusMeters);
    const priorZones = existing.filter((zone) => !fieldId || zone.fieldId === fieldId);
    const prior = new Map(priorZones.map((zone) => [zone.observationIds.slice().sort().join('|'), zone]));
    const zones: ScoutingZone[] = [];
    for (const group of clusters.filter((cluster) => cluster.length >= 2)) {
      const observationIds = group.map((marker) => marker.observationId!).sort(); const key = observationIds.join('|'); const old = prior.get(key) ?? priorZones.find((zone) => zone.crop?.toLocaleLowerCase() === group[0].crop?.toLocaleLowerCase() && zone.condition?.toLocaleLowerCase() === group[0].condition?.toLocaleLowerCase() && zone.observationIds.some((id) => observationIds.includes(id))); const center = centroid(group);
      if (!center) continue;
      const zoneFieldId = fieldId ?? group[0].fieldId!;
      const now = new Date().toISOString(); const hasNewObservation = old && observationIds.some((id) => !old.observationIds.includes(id)); const reopenAfterNewEvidence = hasNewObservation && (old.status === 'verified' || old.status === 'dismissed'); const zone: ScoutingZone = { id: old?.id ?? `zone-${zoneFieldId}-${hash(key)}`, fieldId: zoneFieldId, center, observationIds, crop: group[0].crop, condition: group[0].condition, severity: 'inspection_suggested', status: reopenAfterNewEvidence ? 'inspection_suggested' : old?.status ?? 'inspection_suggested', createdAt: old?.createdAt ?? now, updatedAt: reopenAfterNewEvidence ? now : old ? old.updatedAt : now };
      await this.store.save('scouting-zone', zone); zones.push(zone);
      const linkedEvidence = await this.store.list<ScoutingEvidence>('scouting-evidence');
      for (const evidence of linkedEvidence.filter((item) => item.fieldId === zoneFieldId && item.observationIds.some((id) => observationIds.includes(id)))) {
        if (evidence.zoneId !== zone.id) await this.store.save('scouting-evidence', { ...evidence, zoneId: zone.id, updatedAt: now });
      }
    }
    return zones;
  }
  async listTasks(fieldId?: string) { return (await this.store.list<ScoutingTask>('scouting-task')).filter((task) => !fieldId || task.fieldId === fieldId).sort((a, b) => (b.requestedAt ?? b.createdAt ?? '').localeCompare(a.requestedAt ?? a.createdAt ?? '')); }
  async listZones(fieldId?: string) {
    const active = await this.getZones(fieldId);
    const saved = (await this.store.list<ScoutingZone>('scouting-zone')).filter((zone) => !fieldId || zone.fieldId === fieldId);
    return [...new Map([...saved, ...active].map((zone) => [zone.id, zone])).values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getZone(zoneId: string) { const direct = await this.store.get?.<ScoutingZone>('scouting-zone', zoneId); return direct ?? (await this.store.list<ScoutingZone>('scouting-zone')).find((item) => item.id === zoneId); }
  async listEvidence(fieldId?: string): Promise<ScoutingEvidence[]> { return this.evidenceService.listEvidence(fieldId); }
  async evaluateInspectionSuggestion(observation: CropObservation, zone: ScoutingZone) {
    const alerts = await this.store.list<import('@/domain/models').Alert>('alert');
    const alert = evaluateZoneInspectionAlert(observation, zone.id, alerts, zone.status);
    return alert ? this.store.save('alert', alert) : undefined;
  }
  async verifyZone(zoneId: string, verification: 'verified' | 'dismissed' | 'needs_verification') {
    const zone = await this.store.get?.<ScoutingZone>('scouting-zone', zoneId);
    if (!zone) return undefined;
    const status = verification === 'needs_verification' ? verification : verification;
    const updatedAt = new Date().toISOString();
    await this.store.save('scouting-zone', { ...zone, status, updatedAt });
    const evidenceRows = await this.store.list<ScoutingEvidence>('scouting-evidence');
    for (const evidence of evidenceRows.filter((item) => item.zoneId === zoneId)) await this.evidenceService.setVerification(evidence.id, verification);
    const alerts = await this.store.list<import('@/domain/models').Alert>('alert');
    for (const alert of alerts.filter((item) => item.zoneId === zoneId && ['active', 'acknowledged'].includes(item.status))) {
      if (verification === 'needs_verification') continue;
      await this.store.save('alert', { ...alert, status: verification === 'dismissed' ? 'dismissed' : 'resolved', updatedAt });
    }
    const tasks = await this.listTasks(zone.fieldId);
    for (const task of tasks.filter((item) => item.zoneId === zoneId)) await this.updateTaskStatus(task.id, verification);
    return { ...zone, status, updatedAt };
  }
  async requestTargetedRescan(fieldId: string, zoneId: string, observationIds: string[]) {
    const existing = await this.store.list<ScoutingTask>('scouting-task');
    const duplicate = existing.find((task) => task.zoneId === zoneId && !['verified', 'dismissed', 'rescan_completed', 'evidence_updated'].includes(task.status)); if (duplicate) return duplicate;
    const now = new Date().toISOString(); const zone = await this.store.get?.<ScoutingZone>('scouting-zone', zoneId);
    const task: ScoutingTask = { id: `scout-task-${Date.now()}-${hash(zoneId)}`, fieldId, zoneId, observationIds: [...observationIds], sourceObservationIds: [...observationIds], resultObservationIds: [], status: 'rescan_requested', createdAt: now, requestedAt: now, updatedAt: now, targetLatitude: zone?.center.latitude, targetLongitude: zone?.center.longitude, radius: SCOUTING_ZONE_RADIUS_METERS, reason: 'Inspection suggested by nearby field observations', syncState: 'local' };
    await this.store.save('scouting-task', task);
    if (zone) await this.store.save('scouting-zone', { ...zone, status: 'rescan_requested', updatedAt: now });
    return task;
  }
  async updateTaskStatus(taskId: string, status: ScoutingTaskStatus) { const task = await this.store.get?.<ScoutingTask>('scouting-task', taskId); if (!task) return undefined; const updated = await this.store.save('scouting-task', { ...task, status, updatedAt: new Date().toISOString() }); if (task.zoneId) { const zone = await this.store.get?.<ScoutingZone>('scouting-zone', task.zoneId); if (zone) await this.store.save('scouting-zone', { ...zone, status: status === 'verified' || status === 'dismissed' || status === 'needs_verification' || status === 'evidence_updated' || status === 'rescan_completed' || status === 'rescan_in_progress' || status === 'rescan_requested' ? status : 'inspection_suggested', updatedAt: updated.updatedAt }); } return updated; }
  async startRescan(taskId: string) { const task = await this.store.get?.<ScoutingTask>('scouting-task', taskId); if (!task || !['rescan_requested', 'targeted_rescan_requested'].includes(task.status)) return undefined; return this.updateTaskStatus(taskId, 'rescan_in_progress'); }
  async completeRescan(taskId: string, observation: CropObservation) {
    const task = await this.store.get?.<ScoutingTask>('scouting-task', taskId); if (!task) return undefined;
    const outcome = await this.evidenceService.compareRescan(task, observation);
    if (outcome === 'rescan_unusable') return this.store.save('scouting-task', { ...task, lastRescanOutcome: outcome, status: 'rescan_requested', updatedAt: new Date().toISOString() });
    const completedAt = new Date().toISOString();
    await this.store.save('scouting-task', { ...task, resultObservationIds: [...new Set([...(task.resultObservationIds ?? []), observation.id])], observationIds: [...new Set([...task.observationIds, observation.id])], status: 'rescan_completed', completedAt, lastRescanOutcome: outcome, updatedAt: completedAt });
    await this.updateTaskStatus(taskId, 'evidence_updated');
    const needsVerification = await this.updateTaskStatus(taskId, 'needs_verification');
    if (needsVerification) return this.store.save('scouting-task', { ...needsVerification, evidenceUpdatedAt: needsVerification.updatedAt });
    return undefined;
  }
  async markRescanUnusable(taskId: string) { const task = await this.store.get?.<ScoutingTask>('scouting-task', taskId); return task ? this.store.save('scouting-task', { ...task, status: 'rescan_requested', lastRescanOutcome: 'rescan_unusable', updatedAt: new Date().toISOString() }) : undefined; }
}

export function summarizeFieldHealth(observations: CropObservation[], zones: ScoutingZone[], tasks: ScoutingTask[] = []) {
  const real = observations.filter((item) => item.source !== 'simulated' && item.scanStatus !== 'unavailable');
  return { observationCount: real.length, possibleIssueCount: real.filter((item) => item.scanStatus === 'possible_issue').length, healthyLookingCount: real.filter((item) => item.scanStatus === 'healthy_looking').length, inspectionAreaCount: zones.length, pendingRescanCount: tasks.filter((task) => ['rescan_requested', 'targeted_rescan_requested', 'rescan_in_progress'].includes(task.status)).length };
}

function isZoneEligible(marker: MapObservation, minimumConfidence = SCOUTING_MIN_CONFIDENCE) { return marker.source !== 'simulated' && (marker.category === 'possible_issue' || (marker.category === 'needs_verification' && marker.status === 'possible_issue')) && marker.verificationStatus === 'requires_verification' && Number.isFinite(marker.confidence) && marker.confidence! >= minimumConfidence && !!marker.crop && !!marker.condition; }
function groupNearby(markers: MapObservation[], radiusMeters = SCOUTING_ZONE_RADIUS_METERS) { const remaining = new Set(markers); const groups: MapObservation[][] = []; while (remaining.size) { const first = remaining.values().next().value as MapObservation; remaining.delete(first); const group = [first]; for (const candidate of [...remaining]) { if (sameProblem(first, candidate) && distanceMeters(first, candidate) <= radiusMeters) { group.push(candidate); remaining.delete(candidate); } } groups.push(group); } return groups; }
function sameProblem(a: MapObservation, b: MapObservation) { return a.fieldId === b.fieldId && a.crop?.toLocaleLowerCase() === b.crop?.toLocaleLowerCase() && (a.rawCondition ?? a.condition)?.toLocaleLowerCase() === (b.rawCondition ?? b.condition)?.toLocaleLowerCase(); }
function distanceMeters(a: GeoPoint, b: GeoPoint) { const r = 6_371_000; const p1 = a.latitude * Math.PI / 180; const p2 = b.latitude * Math.PI / 180; const dp = (b.latitude - a.latitude) * Math.PI / 180; const dl = (b.longitude - a.longitude) * Math.PI / 180; const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }
function centroid(points: GeoPoint[]) { const latitude = points.reduce((sum, item) => sum + item.latitude, 0) / points.length; const longitude = points.reduce((sum, item) => sum + item.longitude, 0) / points.length; return isValidGeoPoint({ latitude, longitude }) ? { latitude, longitude } : undefined; }
function validPoint(latitude: number | null, longitude: number | null): GeoPoint | undefined { if (latitude === null || longitude === null) return undefined; const point = { latitude, longitude }; return isValidGeoPoint(point) ? point : undefined; }
function validFix(fix: string) { return ['2d', '3d', 'dgps', 'rtk_float', 'rtk_fixed'].includes(fix); }
function hash(value: string) { let h = 2166136261; for (const char of value) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
