import type { Advisory, Alert, CropObservation, CropScanStatus, DataSource, Drone, DroneTelemetry, Farm, Field, FlightImage, FlightMission, Sensor, SensorConnection, SensorHealth, SensorNode, SensorReading, SyncRecord } from '@/domain/models';

export interface ObservationQuery { farmId?: string; fieldId?: string; from?: string; to?: string; source?: DataSource; crop?: string; status?: CropScanStatus | CropObservation['verificationStatus'] }

export interface FarmRepository { listFarms(): Promise<Farm[]>; getFarm(id: string): Promise<Farm | undefined> }
export interface FieldRepository { listFields(farmId?: string): Promise<Field[]>; getField(id: string): Promise<Field | undefined> }
export interface SensorProvider { listNodes(): Promise<SensorNode[]>; listSensors(): Promise<Sensor[]>; latestReadings(): Promise<SensorReading[]>; history(sensorId?: string, limit?: number): Promise<SensorReading[]>; listHealth(): Promise<SensorHealth[]>; getConnection(): SensorConnection }
export interface RealSensorProvider extends SensorProvider { readonly transport: 'esp32-serial' | 'esp32-local-network' | 'gateway' }
export interface DroneTelemetryProvider { listDrones(): Promise<Drone[]>; listMissions(): Promise<FlightMission[]>; listImages(): Promise<FlightImage[]>; listDroneTelemetry(): Promise<DroneTelemetry[]> }
export interface ObservationRepository { listObservations(fieldId?: string | ObservationQuery): Promise<CropObservation[]>; getObservation(id: string): Promise<CropObservation | undefined>; updateObservationVerification(id: string, state: CropObservation['verificationStatus'], note?: string): Promise<CropObservation | undefined> }
export interface ObservationAlertEvaluator { evaluate(observation: CropObservation): Alert | undefined }
export interface AlertRepository { listAlerts(): Promise<Alert[]> }
export interface AdvisoryRepository { listAdvisories(): Promise<Advisory[]> }
export interface SyncService { getStatus(): Promise<{ lastSyncAt?: string; pending: number; failed: number; online?: boolean }>; listRecords(): Promise<SyncRecord[]>; syncPending(): Promise<void> }
export interface BackendProvider extends FarmRepository, FieldRepository, SensorProvider, DroneTelemetryProvider, ObservationRepository, AlertRepository, AdvisoryRepository, SyncService { readonly source: 'backend' }
