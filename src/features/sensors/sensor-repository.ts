import { localStore } from '@/data/storage/local-store';
import { createSensorRepository } from '@/features/sensors/sensor-repository-core';

/** Sensor entities use the same SQLite/localStorage entity table as existing farm records. */
export const sensorRepository = createSensorRepository(localStore);
