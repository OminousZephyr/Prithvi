import type { MapObservation } from '@/domain/models';
import { isValidFieldBoundary } from './field-geometry.ts';
import type { ScoutingMapData } from './scouting-types';

export class OpenStreetMapProvider {
  readonly id = 'openstreetmap' as const;
  readonly requiresApiKey = false as const;
  readonly onlineTiles = true as const;
  createViewData(data: ScoutingMapData) { return { ...data, boundary: isValidFieldBoundary(data.boundary) ? data.boundary : undefined, draftPoints: (data.draftPoints ?? []).filter((point) => validCoordinate(point.latitude, point.longitude)), seedCenter: data.seedCenter && validCoordinate(data.seedCenter.latitude, data.seedCenter.longitude) ? data.seedCenter : undefined, observations: data.observations.filter(validMarker), zones: (data.zones ?? []).filter((zone) => validCoordinate(zone.center.latitude, zone.center.longitude)), sensorLocations: (data.sensorLocations ?? []).filter((sensor) => validCoordinate(sensor.latitude, sensor.longitude)), track: data.track.filter((point) => validCoordinate(point.latitude, point.longitude)), dronePosition: data.dronePosition && validCoordinate(data.dronePosition.latitude, data.dronePosition.longitude) ? data.dronePosition : undefined }; }
}
function validMarker(item: MapObservation) { return validCoordinate(item.latitude, item.longitude) && Boolean(item.observationId); }
function validCoordinate(latitude: number, longitude: number) { return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180; }
