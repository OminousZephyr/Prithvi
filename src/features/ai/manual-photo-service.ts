import type { Field, CropObservation, GeoPoint } from '@/domain/models';
import type { AIAnalysisMetadata, AIAnalysisResult } from './ai-types.ts';
import type { AIRepository } from './ai-repository.ts';

export interface OnDevicePhotoProvider { analyzeImage(imageUri: string, metadata: AIAnalysisMetadata): Promise<AIAnalysisResult> }

/** Manual photos always use the supplied on-device provider; this service has no server fallback. */
export class ManualPhotoDiagnosticsService {
  private readonly onDeviceProvider: OnDevicePhotoProvider;
  private readonly observations: Pick<AIRepository, 'saveScan'>;
  constructor(onDeviceProvider: OnDevicePhotoProvider, observations: Pick<AIRepository, 'saveScan'>) { this.onDeviceProvider = onDeviceProvider; this.observations = observations; }

  analyze(imageUri: string, options: { fieldId?: string; capturedAt: string; onProgress?: AIAnalysisMetadata['onProgress'] }): Promise<AIAnalysisResult> {
    return this.onDeviceProvider.analyzeImage(imageUri, { source: 'manual_photo', fieldId: options.fieldId, capturedAt: options.capturedAt, onProgress: options.onProgress });
  }

  save(result: AIAnalysisResult, imageUri: string, capturedAt: string, field?: Field, selectedLocation?: { point: GeoPoint; source: 'phone' | 'manual' }): Promise<CropObservation | undefined> {
    if (!isSavableManualPhotoResult(result)) return Promise.resolve(undefined);
    const location = isValidPoint(selectedLocation?.point) ? selectedLocation : undefined;
    const metadata: AIAnalysisMetadata = { source: 'manual_photo', fieldId: field?.id, capturedAt, latitude: location?.point.latitude, longitude: location?.point.longitude };
    return this.observations.saveScan(result, metadata, imageUri, { ...(field ? { fieldId: field.id, farmId: field.farmId, growthStage: field.crop?.growthStage } : {}), ...(location ? { latitude: location.point.latitude, longitude: location.point.longitude, locationSource: location.source } : {}) });
  }
}

export function isSavableManualPhotoResult(result: AIAnalysisResult): boolean {
  return ['possible_issue', 'healthy_looking', 'uncertain'].includes(result.status) && result.source === 'manual_photo'
    && result.imageQuality.status === 'acceptable' && Number.isFinite(result.confidence)
    && (result.confidence ?? -1) >= 0 && (result.confidence ?? 2) <= 1
    && !!result.rawLabel && !!result.modelVersion && result.provider === 'on_device_ai' && result.inferenceValidated === true;
}

export function isUnsupportedManualPhoto(image: { mimeType?: string | null; fileName?: string | null; uri: string }): boolean {
  if (image.mimeType && image.mimeType.toLowerCase() !== 'image/jpeg') return true;
  const name = `${image.fileName ?? ''} ${image.uri.split('?')[0]}`.toLowerCase();
  return /\.(heic|heif|png|webp|avif|gif|bmp|tiff?)$/.test(name);
}

function isValidPoint(point?: GeoPoint): point is GeoPoint {
  return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180;
}
