import type { CropObservation, ObservationProvenance } from '@/domain/models';
import type { ObservationQuery } from '@/domain/ports/repositories';
import type { AIAnalysisMetadata, AIAnalysisResult } from './ai-types.ts';
import type { ObservationCaptureContext } from '@/features/drone/observation-capture-context';
import { ScoutingEvidenceService } from '../scouting/scouting-evidence.ts';
import { ScoutingRepository } from '../scouting/scouting-repository.ts';

export interface AIObservationStore {
  list<T>(type: string): Promise<T[]>;
  get?<T>(type: string, id: string): Promise<T | undefined>;
  save<T extends { id: string }>(type: string, value: T): Promise<T>;
}

export interface ObservationEnrichment extends Partial<ObservationCaptureContext> {
  farmId?: string;
  growthStage?: string;
  latitude?: number;
  longitude?: number;
  altitudeM?: number;
  headingDegrees?: number;
  sensorContext?: CropObservation['sensorContext'];
  droneContext?: CropObservation['droneContext'];
  fieldId?: string;
  gpsFix?: CropObservation['gpsFix'];
  locationSource?: CropObservation['locationSource'];
  droneTelemetryAt?: string;
  droneId?: string;
  flightSessionId?: string;
}

const OBSERVATION_TYPE = 'crop-observation';
let scanSequence = 0;

export class AIRepository {
  private readonly store: AIObservationStore;
  constructor(store: AIObservationStore) { this.store = store; }

  async listObservations(query?: string | ObservationQuery) {
    const observations = await this.store.list<CropObservation>(OBSERVATION_TYPE);
    const filters = typeof query === 'string' ? { fieldId: query } : query ?? {};
    const from = dateBound(filters.from, false);
    const to = dateBound(filters.to, true);
    return observations.map(normalizeObservation).filter((item) => {
      const timestamp = item.timestamp ?? item.observedAt;
      return (!filters.farmId || item.farmId === filters.farmId)
        && (!filters.fieldId || item.fieldId === filters.fieldId)
        && (!from || timestamp >= from)
        && (!to || timestamp <= to)
        && (!filters.source || item.source === filters.source)
        && (!filters.crop || item.crop?.toLocaleLowerCase() === filters.crop.toLocaleLowerCase())
        && (!filters.status || item.healthStatus === filters.status || item.verificationStatus === filters.status);
    }).sort((a, b) => (b.timestamp ?? b.observedAt).localeCompare(a.timestamp ?? a.observedAt));
  }

  async getObservation(id: string) {
    const item = await this.store.get?.<CropObservation>(OBSERVATION_TYPE, id);
    return item ? normalizeObservation(item) : (await this.store.list<CropObservation>(OBSERVATION_TYPE)).map(normalizeObservation).find((entry) => entry.id === id);
  }

  async updateObservationVerification(id: string, state: CropObservation['verificationStatus'], note?: string) {
    const existing = await this.getObservation(id);
    if (!existing) return undefined;
    const changedAt = new Date().toISOString();
    const provenance = new Set(existing.provenance ?? []);
    if (state !== 'requires_verification') provenance.add('manual');
    const updated: CropObservation = {
      ...existing,
      verificationStatus: state,
      verifiedAt: state === 'verified' ? changedAt : undefined,
      verificationChangedAt: changedAt,
      verificationBy: 'farmer',
      verificationNote: note?.trim() || undefined,
      provenance: [...provenance],
      syncState: 'pending',
      syncStatus: 'pending',
      verificationHistory: [...(existing.verificationHistory ?? []), { state, changedAt, by: 'farmer', note: note?.trim() || undefined }],
    };
    return normalizeObservation(await this.store.save(OBSERVATION_TYPE, updated));
  }

  /** Unavailable/low-quality outputs are not crop observations and are never saved as diagnoses. */
  async saveScan(result: AIAnalysisResult, metadata: AIAnalysisMetadata, imageReference: string, enrichment: ObservationEnrichment = {}): Promise<CropObservation | undefined> {
    if (!['possible_issue', 'healthy_looking', 'uncertain'].includes(result.status) || result.imageQuality.status !== 'acceptable' || !Number.isFinite(result.confidence) || result.confidence === undefined || result.confidence === null || result.confidence < 0 || result.confidence > 1 || !result.modelVersion || !result.rawLabel || result.provider !== 'on_device_ai' || result.inferenceValidated !== true) return undefined;
    const id = `crop-scan-${Date.now()}-${++scanSequence}`;
    const location = createPoint(enrichment.latitude, enrichment.longitude) ?? createPoint(metadata.latitude, metadata.longitude);
    const provenance = new Set<ObservationProvenance>(result.provenance?.filter(isObservationProvenance) ?? ['on_device_ai']);
    if (enrichment.sensorContext) provenance.add('ground_sensor');
    if (enrichment.droneContext) provenance.add('drone_telemetry');
    if (location) provenance.add('fused');
    if (provenance.size > 1) provenance.add('fused');
    const observation: CropObservation = {
      id,
      fieldId: enrichment.fieldId ?? metadata.fieldId,
      farmId: enrichment.farmId,
      flightSessionId: enrichment.flightSessionId,
      droneId: enrichment.droneId ?? enrichment.droneContext?.droneId,
      droneTelemetryAt: enrichment.droneTelemetryAt ?? enrichment.droneContext?.timestamp,
      locationSource: location ? enrichment.locationSource ?? (enrichment.droneContext ? 'drone' : metadata.latitude !== undefined ? 'unknown' : 'unknown') : undefined,
      gpsFix: enrichment.gpsFix ?? enrichment.droneContext?.gpsFix,
      kind: 'crop_health',
      title: result.status === 'possible_issue' ? 'Possible crop-health issue' : result.status === 'uncertain' ? 'Uncertain crop-health screening result' : 'Healthy-looking crop',
      description: result.observation ?? undefined,
      observedAt: result.timestamp,
      timestamp: result.timestamp,
      location,
      latitude: location?.latitude,
      longitude: location?.longitude,
      headingDegrees: enrichment.headingDegrees ?? enrichment.droneContext?.headingDegrees,
      source: result.source,
      confidence: result.confidence,
      evidence: [result.source === 'esp32_cam_rgb' ? 'ESP32-CAM RGB image' : result.source === 'manual_photo' ? 'Manual photo' : 'Local RGB image', `Image decode and minimum-size check: ${result.imageQuality.status}`],
      verificationStatus: 'requires_verification',
      ai: { modelName: 'MobileNetV3Large PlantVillage TFLite', modelVersion: result.modelVersion, confidence: result.confidence, timestamp: result.timestamp, observationId: id, imageId: id, uncertainty: 'PlantVillage classes may not represent field conditions; field verification is required.', abstained: result.status === 'uncertain', abstentionReason: result.status === 'uncertain' ? 'Below the configured confidence threshold.' : undefined },
      syncState: 'local',
      syncStatus: 'local',
      crop: result.crop,
      growthStage: enrichment.growthStage,
      condition: result.condition,
      rawLabel: result.rawLabel,
      rawModelLabel: result.rawLabel,
      scanStatus: result.status,
      healthStatus: result.status,
      imageReference,
      imageSyncStatus: 'local_only',
      imageQuality: result.imageQuality.status,
      modelVersion: result.modelVersion,
      altitudeM: enrichment.altitudeM ?? enrichment.droneContext?.altitudeM ?? metadata.altitudeM,
      sensorContext: enrichment.sensorContext,
      droneContext: enrichment.droneContext,
      dataQuality: 'limited',
      provenance: [...provenance],
    };
    const saved = await this.store.save(OBSERVATION_TYPE, observation);
    const evidence = await new ScoutingEvidenceService(this.store).recordObservation(saved).catch(() => undefined);
    if (evidence && saved.fieldId) {
      const scouting = new ScoutingRepository(this.store);
      const zones = await scouting.getZones(saved.fieldId).catch(() => []);
      const zone = zones.find((item) => item.observationIds.includes(saved.id));
      if (zone) await scouting.evaluateInspectionSuggestion(saved, zone).catch(() => undefined);
    }
    return saved;
  }
}

function createPoint(latitude?: number, longitude?: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude! >= -90 && latitude! <= 90 && longitude! >= -180 && longitude! <= 180
    ? { latitude: latitude!, longitude: longitude! } : undefined;
}

function isObservationProvenance(value: string): value is ObservationProvenance {
  return ['on_device_ai', 'esp32_cam_rgb', 'ground_sensor', 'drone_telemetry', 'manual', 'fused'].includes(value);
}

function normalizeObservation(item: CropObservation): CropObservation {
  const timestamp = item.timestamp ?? item.observedAt;
  return { ...item, timestamp, observedAt: item.observedAt ?? timestamp, rawModelLabel: item.rawModelLabel ?? item.rawLabel, rawLabel: item.rawLabel ?? item.rawModelLabel, syncStatus: item.syncStatus ?? item.syncState };
}

function dateBound(value: string | undefined, end: boolean) {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : value;
}
