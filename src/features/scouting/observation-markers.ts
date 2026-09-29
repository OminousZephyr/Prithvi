import type { CropObservation, MapObservation } from '@/domain/models';
import { isValidGeoPoint } from './field-geometry.ts';

export function toMapObservation(item: CropObservation): MapObservation | undefined {
  if (item.source === 'simulated' || item.source === 'model' || item.source === 'environment' || item.scanStatus === 'unavailable') return undefined;
  const point = item.location ?? (Number.isFinite(item.latitude) && Number.isFinite(item.longitude) ? { latitude: item.latitude!, longitude: item.longitude! } : undefined);
  if (!point || !isValidGeoPoint(point)) return undefined;
  const category = item.verificationStatus === 'requires_verification' ? 'needs_verification' : item.scanStatus === 'healthy_looking' ? 'healthy_looking' : item.scanStatus === 'possible_issue' ? 'possible_issue' : 'uncertain';
  return { latitude: point.latitude, longitude: point.longitude, title: item.title, timestamp: item.timestamp ?? item.observedAt, observationId: item.id, status: item.scanStatus ?? item.verificationStatus, fieldId: item.fieldId, crop: item.crop, condition: item.condition, rawCondition: item.rawModelLabel ?? item.rawLabel ?? item.condition, confidence: item.confidence, source: item.source, verificationStatus: item.verificationStatus, category };
}
export function toMapObservations(items: CropObservation[], fieldId?: string) { return items.filter((item) => !fieldId || item.fieldId === fieldId).flatMap((item) => { const marker = toMapObservation(item); return marker ? [marker] : []; }); }
