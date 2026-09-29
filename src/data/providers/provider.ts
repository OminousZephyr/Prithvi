import type { AdvisoryRepository, AlertRepository, DroneTelemetryProvider, FarmRepository, FieldRepository, ObservationRepository, SensorProvider, SyncService } from '@/domain/ports/repositories';

export interface PrithviProvider extends FarmRepository, FieldRepository, SensorProvider, DroneTelemetryProvider, ObservationRepository, AlertRepository, AdvisoryRepository, SyncService {
  readonly source: 'simulated' | 'local' | 'device' | 'backend';
}
