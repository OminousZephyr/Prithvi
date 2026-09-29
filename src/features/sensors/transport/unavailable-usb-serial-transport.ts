import type { SensorConnection } from '@/domain/models';
import type { SensorLineTransport } from '@/features/sensors/contracts';

/** Safe default until an Android USB-serial native adapter is added to a development build. */
export class UnavailableUsbSerialTransport implements SensorLineTransport {
  readonly kind = 'usb-serial' as const;
  private connection: SensorConnection = { transport: this.kind, status: 'unavailable', detail: 'USB serial support is not connected in this app build.' };
  async connect(_onChunk: (chunk: string) => void): Promise<() => void> { throw new Error(this.connection.detail); }
  subscribeConnection(_listener: (connection: SensorConnection) => void) { return () => undefined; }
  async disconnect() { this.connection = { ...this.connection, status: 'disconnected' }; }
  getConnection() { return this.connection; }
}
