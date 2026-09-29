import type { Alert, DroneTelemetry, Farm, Field } from '@/domain/models';
import type { PrithviProvider } from '@/data/providers/provider';
import { mockProvider } from '@/data/providers/mock-provider';
import { localStore } from '@/data/storage/local-store';
import { sensorRepository } from '@/features/sensors/sensor-repository';
import { AIRepository } from '@/features/ai/ai-repository';
import { normalizeFieldGeometry } from '@/features/scouting/field-geometry';
import { advisoryRepository } from '@/features/advisory/advisory-runtime';

const observationRepository = new AIRepository(localStore);

/** Local SQLite for farmer-entered records; hardware, imagery and remote sync remain unavailable. */
export const localProvider: PrithviProvider = {
  ...mockProvider,
  source: 'local',
  async listFarms() { return localStore.list<Farm>('farm'); },
  async getFarm(id) { return localStore.get<Farm>('farm', id); },
  async listFields(farmId) {
    const fields = await localStore.list<Field>('field');
    const scoped = farmId ? fields.filter((field) => field.farmId === farmId) : fields;
    return scoped.map(normalizeFieldGeometry);
  },
  async getField(id) { const field = await localStore.get<Field>('field', id); return field ? normalizeFieldGeometry(field) : undefined; },
  async listObservations(query) { return observationRepository.listObservations(query); },
  async getObservation(id) { return observationRepository.getObservation(id); },
  async updateObservationVerification(id, state, note) { const result = await observationRepository.updateObservationVerification(id, state, note); await advisoryRepository.refresh(); return result; },
  async listNodes() { return sensorRepository.listNodes(); },
  async listSensors() { return sensorRepository.listSensors(); },
  async latestReadings() { return sensorRepository.latestReadings(); },
  async history(sensorId, limit) { return sensorRepository.history(sensorId, limit); },
  async listHealth() { return sensorRepository.listHealth(); },
  async listDroneTelemetry() { return localStore.list<DroneTelemetry>('drone-telemetry'); },
  async listAdvisories() { return advisoryRepository.refresh(); },
  async listAlerts() { return localStore.list<Alert>('alert'); },
  async getStatus() {
    const { pending, failed } = await localStore.syncCounts();
    return { pending, failed };
  },
  async listRecords() { return localStore.listSyncRecords(); },
};
