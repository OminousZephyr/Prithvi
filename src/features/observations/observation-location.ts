import type { GPSFixQuality, GeoPoint } from '@/domain/models';

export interface ObservationLocationFix { point: GeoPoint; altitudeM?: number; headingDegrees?: number; gpsFix?: GPSFixQuality; source: 'drone' | 'phone' | 'manual' | 'unknown'; observedAt: string; droneId?: string; telemetryAt?: string }
export interface ObservationLocationProvider { getCurrentFix(): Promise<ObservationLocationFix | undefined> }
export interface ExplicitLocationProvider { getLocation(): Promise<ObservationLocationFix | undefined> }
export class UnavailableObservationLocationProvider implements ObservationLocationProvider { async getCurrentFix(): Promise<ObservationLocationFix | undefined> { return undefined; } }

/** Aerial priority is fresh real drone GPS first. Other locations require explicit provider selection. */
export class ObservationLocationService implements ObservationLocationProvider {
  private readonly droneLocation: ExplicitLocationProvider;
  private readonly explicitFallback?: ExplicitLocationProvider;
  constructor(droneLocation: ExplicitLocationProvider, explicitFallback?: ExplicitLocationProvider) { this.droneLocation = droneLocation; this.explicitFallback = explicitFallback; }
  async getCurrentFix() { return await this.droneLocation.getLocation() ?? await this.explicitFallback?.getLocation(); }
}
