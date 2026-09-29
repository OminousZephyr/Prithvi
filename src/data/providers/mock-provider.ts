import type { PrithviProvider } from '@/data/providers/provider';
import type { SensorConnection } from '@/domain/models';

/** Empty by design: no farm/device observations are invented for the demo provider. */
export const mockProvider: PrithviProvider = {
  source: 'simulated',
  async listFarms() { return []; },
  async getFarm() { return undefined; },
  async listFields() { return []; },
  async getField() { return undefined; },
  async listNodes() { return []; },
  async listSensors() { return []; },
  async latestReadings() { return []; },
  async history() { return []; },
  async listHealth() { return []; },
  getConnection(): SensorConnection { return { transport: 'usb-serial', status: 'unavailable', detail: 'No sensor transport is connected.' }; },
  async listDrones() { return []; },
  async listMissions() { return []; },
  async listImages() { return []; },
  async listDroneTelemetry() { return []; },
  async listObservations() { return []; },
  async getObservation() { return undefined; },
  async updateObservationVerification() { return undefined; },
  async listAlerts() { return []; },
  async listAdvisories() { return []; },
  async getStatus() { return { pending: 0, failed: 0, online: false }; },
  async listRecords() { return []; },
  async syncPending() {},
};
