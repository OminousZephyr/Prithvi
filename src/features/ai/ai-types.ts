import type { CropScanStatus, ImageQualityStatus } from '@/domain/models';

export interface ImageQualityResult { status: ImageQualityStatus; reason: string | null }

export interface AIAnalysisResult {
  status: CropScanStatus;
  reason?: string | null;
  crop: string;
  condition: string;
  confidence?: number | null;
  observation?: string | null;
  modelVersion?: string | null;
  rawLabel?: string | null;
  topAlternatives?: { rawLabel: string; crop: string; condition: string; confidence: number }[];
  source: 'esp32_cam_rgb' | 'manual_photo' | 'local_image';
  imageQuality: ImageQualityResult;
  timestamp: string;
  provider?: 'on_device_ai' | 'optional_local_server';
  provenance?: string[];
  inferenceValidated?: boolean;
}

export interface AIAnalysisMetadata {
  fieldId?: string;
  capturedAt?: string;
  latitude?: number;
  longitude?: number;
  altitudeM?: number;
  headingDegrees?: number;
  imageBlob?: Blob;
  source?: 'esp32_cam_rgb' | 'manual_photo' | 'local_image';
  onProgress?: (phase: 'checking_image' | 'analyzing' | 'preparing_result') => void;
}

export interface CameraCapture { imageUri: string; imageBlob: Blob; capturedAt: string }

export type LocalServiceState = 'unconfigured' | 'connecting' | 'connected' | 'unreachable' | 'error';

export class AIServiceError extends Error {
  readonly kind: 'unconfigured' | 'unreachable' | 'timeout' | 'http' | 'malformed';
  constructor(message: string, kind: 'unconfigured' | 'unreachable' | 'timeout' | 'http' | 'malformed' = 'unreachable') { super(message); this.name = 'AIServiceError'; this.kind = kind; }
}

export class OnDeviceAIUnavailableError extends Error {
  readonly kind: 'unavailable';
  constructor(message: string) { super(message); this.name = 'OnDeviceAIUnavailableError'; this.kind = 'unavailable'; }
}

export class AIImageInputError extends Error {
  readonly kind: 'image';
  constructor(message: string) { super(message); this.name = 'AIImageInputError'; this.kind = 'image'; }
}
