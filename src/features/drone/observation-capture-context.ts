import type { CropObservation, DataSource, DroneTelemetry, GeoPoint, ObservationSensorContext } from '@/domain/models';

/** Snapshot boundary that ties one captured image to only context available at capture time. */
export interface ObservationCaptureContext {
  captureSource: DataSource;
  capturedAt: string;
  imageReference: string;
  droneTelemetry?: DroneTelemetry;
  sensorContext?: ObservationSensorContext;
  location?: GeoPoint;
  locationSource?: CropObservation['locationSource'];
  fieldId?: string;
  farmId?: string;
}
