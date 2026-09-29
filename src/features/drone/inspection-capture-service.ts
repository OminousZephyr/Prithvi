import type { AIAnalysisMetadata, AIAnalysisResult, CameraCapture } from '@/features/ai/ai-types';
import type { AIRepository } from '@/features/ai/ai-repository';
import type { CropObservation, Field, FlightSession } from '@/domain/models';
import type { DroneRepository } from './drone-repository.ts';
import type { OnDevicePhotoProvider } from '@/features/ai/manual-photo-service';
import { createInspectionCaptureContext } from './inspection-capture.ts';

export class InspectionCameraUnavailableError extends Error { constructor() { super('Camera unavailable.'); this.name = 'InspectionCameraUnavailableError'; } }
export class InspectionResultInvalidError extends Error { constructor() { super('The on-device result could not be saved as an observation.'); this.name = 'InspectionResultInvalidError'; } }

export interface InspectionCamera { checkStatus(): Promise<{ connected: boolean }>; capture(): Promise<CameraCapture> }
export interface InspectionWorkflowHooks { refreshAdvisories?: () => Promise<unknown>; refreshAlerts?: () => Promise<unknown> }

/** Orchestrates local capture → on-device inference → local observation; it has no server or flight-control dependency. */
export class DroneInspectionCaptureService {
  private readonly camera: Pick<InspectionCamera, 'checkStatus' | 'capture'>;
  private readonly onDeviceAI: OnDevicePhotoProvider;
  private readonly droneRepository: Pick<DroneRepository, 'getLatestTelemetry' | 'recordImageCapture' | 'associateObservation'>;
  private readonly observations: Pick<AIRepository, 'saveScan'>;
  private readonly hooks: InspectionWorkflowHooks;
  constructor(
    camera: Pick<InspectionCamera, 'checkStatus' | 'capture'>,
    onDeviceAI: OnDevicePhotoProvider,
    droneRepository: Pick<DroneRepository, 'getLatestTelemetry' | 'recordImageCapture' | 'associateObservation'>,
    observations: Pick<AIRepository, 'saveScan'>,
    hooks: InspectionWorkflowHooks = {},
  ) { this.camera = camera; this.onDeviceAI = onDeviceAI; this.droneRepository = droneRepository; this.observations = observations; this.hooks = hooks; }

  async capture(field: Field, session: FlightSession, callbacks: { onProgress?: AIAnalysisMetadata['onProgress']; onCaptured?: (capture: CameraCapture) => void } = {}): Promise<{ capture: CameraCapture; analysis: AIAnalysisResult; observation: CropObservation }> {
    const status = await this.camera.checkStatus();
    if (!status.connected) throw new InspectionCameraUnavailableError();
    const captured = await this.camera.capture();
    await this.droneRepository.recordImageCapture(session.id);
    callbacks.onCaptured?.(captured);
    const telemetry = await this.droneRepository.getLatestTelemetry();
    const context = createInspectionCaptureContext({ telemetry, field, session, capturedAt: captured.capturedAt });
    const analysis = await this.onDeviceAI.analyzeImage(captured.imageUri, {
      ...context.metadata, imageBlob: captured.imageBlob, onProgress: callbacks.onProgress,
    });
    if (!isPersistableDroneResult(analysis)) throw new InspectionResultInvalidError();
    const observation = await this.observations.saveScan(analysis, context.metadata, captured.imageUri, context.enrichment);
    if (!observation) throw new InspectionResultInvalidError();
    await this.droneRepository.associateObservation(session.id, session.droneId);
    await this.hooks.refreshAdvisories?.().catch(() => undefined);
    await this.hooks.refreshAlerts?.().catch(() => undefined);
    return { capture: captured, analysis, observation };
  }
}

export function isPersistableDroneResult(result: AIAnalysisResult) {
  return ['healthy_looking', 'possible_issue', 'uncertain'].includes(result.status) && result.source === 'esp32_cam_rgb'
    && result.imageQuality.status === 'acceptable' && result.provider === 'on_device_ai' && result.inferenceValidated === true
    && Number.isFinite(result.confidence) && (result.confidence ?? -1) >= 0 && (result.confidence ?? 2) <= 1 && !!result.rawLabel && !!result.modelVersion;
}
