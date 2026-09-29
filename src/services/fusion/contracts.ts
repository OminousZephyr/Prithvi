import type { CropObservation, EnvironmentalObservation, RiskEstimate, SensorReading } from '@/domain/models';

export interface FieldContext { fieldId: string; cropStage?: string; observations: CropObservation[]; readings: SensorReading[]; environment: EnvironmentalObservation[]; historyIds: string[]; locationAvailable: boolean }
export interface ObservationInterpreter { observe(imageReference: string): Promise<CropObservation | undefined> }
export interface RiskEstimator { estimate(context: FieldContext): Promise<RiskEstimate[]> }
export interface FarmerAdvisoryService { advise(context: FieldContext, risks: RiskEstimate[]): Promise<import('@/domain/models').Advisory[]> }
// Observations describe evidence; estimators produce risk; advisory services propose actions. Do not average unrelated measurements or convert one layer into another implicitly.
