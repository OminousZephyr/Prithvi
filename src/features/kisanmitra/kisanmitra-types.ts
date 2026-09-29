export type KisanSourceType = 'observation' | 'weather' | 'sensor' | 'price' | 'field' | 'advisory';
export interface KisanSource { type: KisanSourceType; reference: string }
export interface KisanAction { title: string; reason: string }
export interface KisanResponse { answer: string; actions: KisanAction[]; sources: KisanSource[]; confidence: 'high' | 'medium' | 'low'; needs_verification: true }
export interface KisanContext {
  farm?: { id: string; name: string; location?: string };
  field?: { id: string; name: string; crop?: string; variety?: string; growthStage?: string };
  recentObservations: { id: string; timestamp: string; crop?: string; condition?: string; status?: string; confidence?: number; source: string }[];
  scoutingEvidence: { id: string; observationCount: number; crop: string; condition: string; evidenceLevel: string; status: string }[];
  activeAdvisories: { id: string; category: string; title: string; message: string; action: string; priority: string }[];
  activeAlerts: { id: string; type: string; title: string; message: string; priority: string; fieldId?: string }[];
  sensorReadings: { kind: string; value: number; unit: string; observedAt: string; quality: string }[];
  weather?: { fetchedAt: string; current: { temperatureC: number | null; apparentC: number | null; humidityPct: number | null; precipitationMm: number | null; condition: string; windKmh: number | null; windDirectionDegrees: number | null }; nextDays: { date: string; minC: number | null; maxC: number | null; precipitationProbability: number | null; precipitationMm: number | null; condition: string }[] };
  recentCropPrices: { id: string; crop: string; market?: string; value: number; unit: string; observedAt: string }[];
  language: 'en' | 'hi';
}
export interface KisanContextSource { type: string; reference: string }
