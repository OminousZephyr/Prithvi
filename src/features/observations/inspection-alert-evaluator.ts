import type { Alert, CropObservation } from '@/domain/models';
import type { ObservationAlertEvaluator } from '@/domain/ports/repositories';

export class LocalInspectionAlertEvaluator implements ObservationAlertEvaluator {
  private readonly minimumConfidence: number;
  constructor(minimumConfidence = 0.65) { this.minimumConfidence = minimumConfidence; }
  evaluate(observation: CropObservation) { return evaluateInspectionAlert(observation, this.minimumConfidence); }
}

/** Emits only a low-priority inspection reminder for a supported, higher-confidence, unverified real scan. */
export function evaluateInspectionAlert(observation: CropObservation, minimumConfidence = 0.65): Alert | undefined {
  if (observation.scanStatus !== 'possible_issue'
    || observation.verificationStatus !== 'requires_verification'
    || observation.confidence === undefined
    || !Number.isFinite(observation.confidence)
    || observation.confidence < minimumConfidence
    || !observation.provenance?.includes('on_device_ai')
    || observation.source === 'simulated') return undefined;
  const createdAt = observation.timestamp ?? observation.observedAt;
  const dedupeKey = `crop_inspection:${observation.fieldId ?? 'unassigned'}:observation:${observation.id}`;
  return { id: `alert-${hash(dedupeKey)}`, farmId: observation.farmId, fieldId: observation.fieldId, observationId: observation.id,
    type: 'crop_inspection', priority: 'medium', title: 'Inspection suggested', message: 'A crop-health screening raised a possible issue. Inspect the area manually.',
    createdAt, updatedAt: createdAt, status: 'active', dedupeKey, source: 'scouting', syncState: 'local' };
}

/** Returns no new reminder while the same inspection area already has an active one. */
export function evaluateZoneInspectionAlert(observation: CropObservation, zoneId: string, activeAlerts: Alert[], zoneStatus: string, minimumConfidence = 0.65): Alert | undefined {
  if (zoneStatus === 'verified' || zoneStatus === 'dismissed') return undefined;
  if (activeAlerts.some((alert) => alert.zoneId === zoneId && !['resolved', 'dismissed', 'expired'].includes(alert.status))) return undefined;
  const alert = evaluateInspectionAlert(observation, minimumConfidence);
  if (!alert) return undefined;
  const baseKey = `crop_inspection:${observation.fieldId ?? 'unassigned'}:${zoneId}`;
  const priorTerminal = activeAlerts.some((item) => item.zoneId === zoneId && ['resolved', 'dismissed', 'expired'].includes(item.status));
  const dedupeKey = priorTerminal ? `${baseKey}:event:${observation.id}` : baseKey;
  return { ...alert, id: `alert-${hash(dedupeKey)}`, dedupeKey, zoneId };
}

function hash(value: string) { let h = 2166136261; for (const char of value) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
