import type { Field, FieldBoundary, GeoPoint } from '@/domain/models';

export function isValidGeoPoint(point: GeoPoint): boolean { return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180; }
export function isValidFieldBoundary(boundary: FieldBoundary | undefined): boundary is FieldBoundary { return !!boundary && boundary.length >= 3 && boundary.every(isValidGeoPoint) && new Set(boundary.map((point) => `${point.latitude},${point.longitude}`)).size >= 3 && Math.abs(signedArea(boundary)) > 1e-10 && isSimplePolygon(boundary); }
export function pointInFieldBoundary(point: GeoPoint, boundary: FieldBoundary | undefined): boolean {
  if (!isValidGeoPoint(point) || !isValidFieldBoundary(boundary)) return false;
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[j]; const b = boundary[i];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.latitude > point.latitude) !== (b.latitude > point.latitude)
      && point.longitude < ((b.longitude - a.longitude) * (point.latitude - a.latitude)) / (b.latitude - a.latitude) + a.longitude;
    if (crosses) inside = !inside;
  }
  return inside;
}
export function calculateBoundaryArea(boundary: FieldBoundary): { value: number; unit: 'acre' } | undefined {
  if (!isValidFieldBoundary(boundary)) return undefined;
  const radius = 6_371_008.8; const lat0 = boundary.reduce((sum, point) => sum + point.latitude, 0) / boundary.length * Math.PI / 180;
  const points = boundary.map((point) => ({ x: radius * point.longitude * Math.PI / 180 * Math.cos(lat0), y: radius * point.latitude * Math.PI / 180 }));
  let area = 0; for (let i = 0; i < points.length; i += 1) { const next = (i + 1) % points.length; area += points[i].x * points[next].y - points[next].x * points[i].y; }
  const acres = Math.abs(area / 2) / 4046.8564224;
  return Number.isFinite(acres) && acres > 0 ? { value: acres, unit: 'acre' } : undefined;
}
export function boundaryCenter(boundary: FieldBoundary): GeoPoint | undefined { if (!isValidFieldBoundary(boundary)) return undefined; return { latitude: boundary.reduce((sum, point) => sum + point.latitude, 0) / boundary.length, longitude: boundary.reduce((sum, point) => sum + point.longitude, 0) / boundary.length }; }
export function normalizeFieldGeometry(field: Field): Field { if (!isValidFieldBoundary(field.boundary)) return { ...field, boundary: undefined, center: isValidGeoPoint(field.center ?? { latitude: NaN, longitude: NaN }) ? field.center : undefined }; return { ...field, center: field.center && isValidGeoPoint(field.center) ? field.center : boundaryCenter(field.boundary), area: field.area ?? calculateBoundaryArea(field.boundary) }; }
function signedArea(points: GeoPoint[]) { let area = 0; for (let i = 0; i < points.length; i += 1) { const next = (i + 1) % points.length; area += points[i].longitude * points[next].latitude - points[next].longitude * points[i].latitude; } return area / 2; }
function isSimplePolygon(points: GeoPoint[]) {
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const a = points[i]; const b = points[(i + 1) % count];
    if (samePoint(a, b)) return false;
    for (let j = i + 1; j < count; j += 1) {
      if (j === i || j === (i + 1) % count || i === (j + 1) % count) continue;
      const c = points[j]; const d = points[(j + 1) % count];
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}
function segmentsIntersect(a: GeoPoint, b: GeoPoint, c: GeoPoint, d: GeoPoint) {
  const orient = (p: GeoPoint, q: GeoPoint, r: GeoPoint) => (q.longitude - p.longitude) * (r.latitude - p.latitude) - (q.latitude - p.latitude) * (r.longitude - p.longitude);
  const o1 = orient(a, b, c); const o2 = orient(a, b, d); const o3 = orient(c, d, a); const o4 = orient(c, d, b);
  const eps = 1e-12;
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
  return Math.abs(o1) <= eps && pointOnSegment(c, a, b) || Math.abs(o2) <= eps && pointOnSegment(d, a, b) || Math.abs(o3) <= eps && pointOnSegment(a, c, d) || Math.abs(o4) <= eps && pointOnSegment(b, c, d);
}
function pointOnSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint) {
  const cross = (point.latitude - a.latitude) * (b.longitude - a.longitude) - (point.longitude - a.longitude) * (b.latitude - a.latitude);
  return Math.abs(cross) <= 1e-12 && point.latitude >= Math.min(a.latitude, b.latitude) - 1e-12 && point.latitude <= Math.max(a.latitude, b.latitude) + 1e-12 && point.longitude >= Math.min(a.longitude, b.longitude) - 1e-12 && point.longitude <= Math.max(a.longitude, b.longitude) + 1e-12;
}
function samePoint(a: GeoPoint, b: GeoPoint) { return a.latitude === b.latitude && a.longitude === b.longitude; }
