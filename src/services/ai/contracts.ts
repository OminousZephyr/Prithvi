import type { AIResultMetadata, CropObservation } from '@/domain/models';

export interface ImageInput { imageUri: string; fieldId: string; capturedAt: string }
export interface ModelResult { observation?: CropObservation; metadata: AIResultMetadata }
export interface CropHealthModel { observe(input: ImageInput): Promise<ModelResult> }
export type DiseaseDetectionModel = CropHealthModel;
export type PestDetectionModel = CropHealthModel;
export type GrowthStageModel = CropHealthModel;
export interface ImageQualityModel { assess(input: ImageInput): Promise<{ quality: 'acceptable' | 'poor' | 'unknown'; reason?: string }> }
