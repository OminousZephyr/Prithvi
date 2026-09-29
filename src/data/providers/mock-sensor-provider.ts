import type { Sensor, SensorConnection, SensorHealth, SensorNode, SensorReading } from '@/domain/models';
import type { SensorProvider } from '@/domain/ports/repositories';

/** Empty development provider: it intentionally creates no synthetic sensor readings. */
export class MockSensorProvider implements SensorProvider {
  async listNodes(): Promise<SensorNode[]> { return []; }
  async listSensors(): Promise<Sensor[]> { return []; }
  async latestReadings(): Promise<SensorReading[]> { return []; }
  async history(): Promise<SensorReading[]> { return []; }
  async listHealth(): Promise<SensorHealth[]> { return []; }
  getConnection(): SensorConnection { return { transport: 'usb-serial', status: 'unavailable', detail: 'No sensor data is configured.' }; }
}
