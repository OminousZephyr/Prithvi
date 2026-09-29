import type { ObservationLocationFix } from '@/features/observations/observation-location';
import { validGpsFix, isTelemetryFresh } from './drone-status.ts';
import type { DroneRepository } from './drone-repository.ts';

export class DroneGpsLocationProvider {
  private readonly repository: DroneRepository;
  constructor(repository: DroneRepository) { this.repository = repository; }
  async getLocation(): Promise<ObservationLocationFix | undefined> {
    const item = await this.repository.getLatestTelemetry();
    if (!item || item.connectionState !== 'connected' || !validGpsFix(item.gpsFix) || !isTelemetryFresh(item)) return undefined;
    if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude) || item.latitude! < -90 || item.latitude! > 90 || item.longitude! < -180 || item.longitude! > 180) return undefined;
    return { point: { latitude: item.latitude!, longitude: item.longitude! }, altitudeM: item.altitudeM ?? undefined, headingDegrees: item.headingDegrees ?? undefined, gpsFix: item.gpsFix, source: 'drone', observedAt: item.receivedAt, telemetryAt: item.receivedAt, droneId: item.droneId };
  }
}
