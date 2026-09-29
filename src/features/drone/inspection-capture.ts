import type { DroneTelemetry, Field, FlightSession, GeoPoint } from '@/domain/models';
import type { AIAnalysisMetadata } from '@/features/ai/ai-types';
import type { ObservationEnrichment } from '@/features/ai/ai-repository';
import { buildDroneContext } from '../observations/observation-context.ts';
import { isTelemetryFresh, validGpsFix, DRONE_TELEMETRY_FRESH_MS } from './drone-status.ts';

export interface InspectionCaptureContext { metadata: AIAnalysisMetadata; enrichment: ObservationEnrichment; telemetry?: DroneTelemetry; location?: GeoPoint }

/** Associates only fresh connected bridge data and never falls back to the phone's location. */
export function createInspectionCaptureContext(input: { telemetry?: DroneTelemetry; field: Field; session: FlightSession; capturedAt: string; now?: number }): InspectionCaptureContext {
  const captureTime = Date.parse(input.capturedAt);
  const now = input.now ?? captureTime;
  const telemetry = input.telemetry;
  const fresh = !!telemetry && telemetry.source !== 'simulated' && telemetry.connectionState === 'connected'
    && Number.isFinite(captureTime) && Date.parse(telemetry.receivedAt) <= captureTime
    && isTelemetryFresh(telemetry, now, DRONE_TELEMETRY_FRESH_MS);
  const gpsValid = fresh && !!telemetry && validGpsFix(telemetry.gpsFix)
    && Number.isFinite(telemetry.latitude) && Number.isFinite(telemetry.longitude)
    && telemetry.latitude! >= -90 && telemetry.latitude! <= 90 && telemetry.longitude! >= -180 && telemetry.longitude! <= 180;
  const location = gpsValid && telemetry ? { latitude: telemetry.latitude!, longitude: telemetry.longitude! } : undefined;
  const contextTelemetry = fresh && telemetry ? { ...telemetry, latitude: location?.latitude ?? null, longitude: location?.longitude ?? null } : undefined;
  const droneContext = contextTelemetry ? buildDroneContext([contextTelemetry], input.capturedAt) : undefined;
  return {
    metadata: { fieldId: input.field.id, capturedAt: input.capturedAt, source: 'esp32_cam_rgb', latitude: location?.latitude, longitude: location?.longitude, altitudeM: contextTelemetry?.altitudeM ?? undefined, headingDegrees: contextTelemetry?.headingDegrees ?? undefined },
    enrichment: {
      fieldId: input.field.id, farmId: input.field.farmId, growthStage: input.field.crop?.growthStage,
      flightSessionId: input.session.id, droneId: contextTelemetry?.droneId, droneTelemetryAt: contextTelemetry?.receivedAt,
      droneContext, latitude: location?.latitude, longitude: location?.longitude, locationSource: location ? 'drone' : undefined,
      gpsFix: location ? contextTelemetry?.gpsFix : undefined,
      altitudeM: contextTelemetry?.altitudeM ?? undefined, headingDegrees: contextTelemetry?.headingDegrees ?? undefined,
    },
    telemetry: contextTelemetry,
    location,
  };
}
