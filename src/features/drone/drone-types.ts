import type { DroneTelemetry, FlightSession, DroneTrackPoint, TelemetryStatus } from '@/domain/models';

export type { DroneTelemetry, FlightSession, DroneTrackPoint, TelemetryStatus };
export interface TelemetrySnapshot { telemetry?: DroneTelemetry; status: TelemetryStatus; detail?: string }
export interface DroneTelemetryProvider {
  configureBaseUrl(value: string): Promise<string>;
  getConfiguredBaseUrl(): Promise<string | undefined>;
  getStatus(): TelemetrySnapshot;
  getLatestTelemetry(): Promise<DroneTelemetry | undefined>;
  subscribe(listener: (snapshot: TelemetrySnapshot) => void): () => void;
  start(): Promise<void>;
  stop(): void;
}
