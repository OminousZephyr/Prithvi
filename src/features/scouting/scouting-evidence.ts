import type { CropObservation, GeoPoint, ScoutingEvidence, ScoutingEvidenceLevel, ScoutingTask, RescanOutcome } from '@/domain/models';

export interface EvidenceStore {
  list<T>(type: string): Promise<T[]>;
  get?<T>(type: string, id: string): Promise<T | undefined>;
  save<T extends { id: string }>(type: string, value: T): Promise<T>;
}

export interface ScoutingEvidenceOptions {
  radiusMeters: number;
  windowMs: number;
  minimumConfidence: number;
}

export const DEFAULT_SCOUTING_EVIDENCE_OPTIONS: ScoutingEvidenceOptions = {
  radiusMeters: 50,
  windowMs: 24 * 60 * 60 * 1000,
  minimumConfidence: 0.65,
};

export class ScoutingEvidenceService {
  private readonly store: EvidenceStore;
  private readonly options: ScoutingEvidenceOptions;
  constructor(store: EvidenceStore, options = DEFAULT_SCOUTING_EVIDENCE_OPTIONS) { this.store = store; this.options = options; }

  async recordObservation(observation: CropObservation, now = new Date().toISOString()): Promise<ScoutingEvidence | undefined> {
    const point = observationPoint(observation);
    const confidence = observation.confidence;
    const observedAt = observation.timestamp ?? observation.observedAt;
    if (!point || !observation.fieldId || !observation.crop || !rawCondition(observation) || observation.source === 'simulated'
      || observation.verificationStatus !== 'requires_verification' || observation.scanStatus !== 'possible_issue'
      || observation.imageQuality !== 'acceptable' || !Number.isFinite(confidence) || confidence! < this.options.minimumConfidence
      || !Number.isFinite(Date.parse(observedAt))) return undefined;

    const all = (await this.store.list<CropObservation>('crop-observation')).filter((item) => isCorroborationCandidate(item, this.options.minimumConfidence));
    const related = all.filter((candidate) => candidate.fieldId === observation.fieldId
      && candidate.source === observation.source
      && same(candidate.crop, observation.crop)
      && same(rawCondition(candidate), rawCondition(observation))
      && Math.abs(Date.parse(observedAt) - Date.parse(candidate.timestamp ?? candidate.observedAt)) <= this.options.windowMs
      && haversineMeters(point, observationPoint(candidate)!) <= this.options.radiusMeters);
    if (!related.some((item) => item.id === observation.id)) related.push(observation);
    const ids = related.map((item) => item.id).sort();
    const prior = (await this.store.list<ScoutingEvidence>('scouting-evidence')).find((item) => item.fieldId === observation.fieldId
      && item.crop === observation.crop && item.condition === rawCondition(observation)
      && item.observationIds.some((id) => ids.includes(id)) && item.status !== 'dismissed' && item.status !== 'verified');
    const observationTimes = related.map((item) => Date.parse(item.timestamp ?? item.observedAt));
    const firstObservedAt = new Date(Math.min(...observationTimes)).toISOString();
    const lastObservedAt = new Date(Math.max(...observationTimes)).toISOString();
    const conf = related.map((item) => item.confidence!);
    const level = evidenceLevel(related);
    const updatedAt = now;
    const evidence: ScoutingEvidence = {
      id: prior?.id ?? `evidence-${observation.fieldId}-${hash(`${observation.crop}:${rawCondition(observation)}:${ids[0]}`)}`,
      fieldId: observation.fieldId,
      zoneId: prior?.zoneId,
      observationIds: ids,
      observationCount: ids.length,
      firstObservedAt,
      lastObservedAt,
      center: centroid(related.map((item) => observationPoint(item)!)),
      crop: observation.crop,
      condition: rawCondition(observation)!,
      confidenceRange: { min: Math.min(...conf), max: Math.max(...conf) },
      status: prior?.status === 'needs_verification' ? 'needs_verification' : 'inspection_suggested',
      evidenceLevel: level,
      createdAt: prior?.createdAt ?? now,
      updatedAt,
      syncState: 'local',
    };
    return this.store.save('scouting-evidence', evidence);
  }

  async listEvidence(fieldId?: string) {
    return (await this.store.list<ScoutingEvidence>('scouting-evidence')).filter((item) => !fieldId || item.fieldId === fieldId)
      .sort((a, b) => b.lastObservedAt.localeCompare(a.lastObservedAt));
  }

  async setVerification(evidenceId: string, status: ScoutingEvidence['status']) {
    const current = await this.store.get?.<ScoutingEvidence>('scouting-evidence', evidenceId)
      ?? (await this.store.list<ScoutingEvidence>('scouting-evidence')).find((item) => item.id === evidenceId);
    return current ? this.store.save('scouting-evidence', { ...current, status, updatedAt: new Date().toISOString(), syncState: 'local' }) : undefined;
  }

  async compareRescan(task: ScoutingTask, rescan: CropObservation): Promise<RescanOutcome> {
    if (rescan.imageQuality !== 'acceptable' || rescan.scanStatus === 'unavailable') return 'rescan_unusable';
    if (rescan.scanStatus === 'uncertain') return 'still_uncertain';
    const originals = await this.store.list<CropObservation>('crop-observation');
    const original = originals.find((item) => (task.sourceObservationIds ?? task.observationIds).includes(item.id));
    if (!original) return 'still_uncertain';
    if (rescan.scanStatus === 'healthy_looking') return 'issue_not_reproduced';
    if (rescan.scanStatus === 'possible_issue' && same(original.crop, rescan.crop)
      && same(rawCondition(original), rawCondition(rescan))) return 'issue_repeated';
    return 'result_changed';
  }
}

export function evidenceLevel(observations: CropObservation[]): ScoutingEvidenceLevel {
  if (observations.length < 2) return 'single_observation';
  return new Set(observations.map((item) => Date.parse(item.timestamp ?? item.observedAt))).size > 1 ? 'corroborated' : 'repeated_observation';
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const r = 6_371_000;
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function observationPoint(item: CropObservation): GeoPoint | undefined {
  const latitude = item.location?.latitude ?? item.latitude;
  const longitude = item.location?.longitude ?? item.longitude;
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude! >= -90 && latitude! <= 90 && longitude! >= -180 && longitude! <= 180
    ? { latitude: latitude!, longitude: longitude! } : undefined;
}
function isCorroborationCandidate(item: CropObservation, minimumConfidence: number) {
  return !!observationPoint(item) && !!item.fieldId && !!item.crop && !!rawCondition(item) && item.source !== 'simulated'
    && item.verificationStatus === 'requires_verification' && item.scanStatus === 'possible_issue' && item.imageQuality === 'acceptable'
    && Number.isFinite(item.confidence) && item.confidence! >= minimumConfidence;
}
function rawCondition(item: CropObservation) { return item.rawModelLabel ?? item.rawLabel ?? item.condition; }
function same(a?: string, b?: string) { return (a ?? '').trim().toLocaleLowerCase() === (b ?? '').trim().toLocaleLowerCase(); }
function centroid(points: GeoPoint[]): GeoPoint { return { latitude: points.reduce((sum, p) => sum + p.latitude, 0) / points.length, longitude: points.reduce((sum, p) => sum + p.longitude, 0) / points.length }; }
function hash(value: string) { let h = 2166136261; for (const char of value) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
