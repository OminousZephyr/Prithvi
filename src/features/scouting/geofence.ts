import type { FieldBoundary, GeoPoint } from '@/domain/models';
import { isValidGeoPoint, isValidFieldBoundary, pointInFieldBoundary } from './field-geometry.ts';

export type GeofenceState = 'inside' | 'outside' | 'unknown';

/** Read-only geographic relationship between one real GPS fix and one saved field polygon. */
export function evaluateFieldGeofence(boundary: FieldBoundary | undefined, position?: GeoPoint | null): GeofenceState {
  if (!position || !isValidGeoPoint(position) || !isValidFieldBoundary(boundary)) return 'unknown';
  return pointInFieldBoundary(position, boundary) ? 'inside' : 'outside';
}
