import type { Advisory, AdvisoryContext, RiskSignal, SensorReading } from '@/domain/models';

export const DEFAULT_ADVISORY_CONFIDENCE = 0.65;
export const DEFAULT_SENSOR_FRESHNESS_MS = 15 * 60 * 1000;
export const DEFAULT_ADVISORY_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

export interface AdvisoryEvaluation { advisories: Advisory[]; riskSignals: RiskSignal[] }

/** Pure, deterministic rules. It only reasons over context supplied from local records. */
export function evaluateAdvisoryContext(context: AdvisoryContext): AdvisoryEvaluation {
  const advisories: Advisory[] = [];
  const riskSignals: RiskSignal[] = [];
  const freshnessMs = context.rule?.staleAfterMs ?? DEFAULT_SENSOR_FRESHNESS_MS;
  const validForMs = context.rule?.validForMs ?? DEFAULT_ADVISORY_VALIDITY_MS;
  const minimumConfidence = context.rule?.minimumConfidence ?? DEFAULT_ADVISORY_CONFIDENCE;
  const now = Date.parse(context.now);
  const emit = (input: Omit<Advisory, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'syncState' | 'deduplicationKey' | 'expiresAt'> & { identity: string }) => {
    const { identity, ...advisory } = input;
    const key = dedupKey(advisory.fieldId, advisory.zoneId, advisory.sourceObservationIds, advisory.category, advisory.ruleId, identity);
    advisories.push({ ...advisory, id: `advisory-${hash(key)}`, deduplicationKey: key, createdAt: context.now, updatedAt: context.now, expiresAt: new Date(now + validForMs).toISOString(), status: 'active', syncState: 'local' });
    return key;
  };
  const signal = (type: RiskSignal['type'], value: number | string | undefined, unit: string | undefined, source: RiskSignal['source'], confidence: number | undefined, observationIds: string[] = [], evidenceIds: string[] = [], sensorReadingIds: string[] = [], identity = '') => {
    riskSignals.push({ id: `risk-${hash(`${context.fieldId}:${type}:${identity}`)}`, fieldId: context.fieldId, farmId: context.farmId, createdAt: context.now, type, value, unit, source, confidence, validUntil: new Date(now + validForMs).toISOString(), evidenceReference: { observationIds, evidenceIds, sensorReadingIds }, ruleId: `risk-${type}`, syncState: 'local' });
  };

  for (const observation of context.observations) {
    if (observation.source === 'simulated' || observation.source === 'model' || observation.source === 'environment' || observation.scanStatus === 'unavailable' || !observation.provenance?.includes('on_device_ai')) continue;
    if (observation.verificationStatus === 'dismissed') continue;
    if (observation.imageQuality === 'low') {
      const id = emit({ identity: observation.id, farmId: observation.farmId ?? context.farmId, fieldId: observation.fieldId ?? context.fieldId, priority: 'low', category: 'image_quality', title: 'Capture a clearer image', message: 'The image quality may limit this crop observation.', action: 'Take a clearer close-up or rescan the area.', reason: 'Image-quality checks marked this image as low quality.', sourceObservationIds: [observation.id], sourceEvidenceIds: [], sourceSensorReadingIds: [], verificationState: 'pending', ruleId: 'image-quality-low' });
      signal('low_image_quality', 'low', undefined, observation.source, undefined, [observation.id], [], [], id);
      continue;
    }
    const allMatchingEvidence = context.evidence.filter((item) => item.fieldId === context.fieldId && item.observationIds.includes(observation.id));
    if (observation.scanStatus === 'possible_issue' && observation.verificationStatus === 'verified') {
      emit({ identity: observation.id, farmId: observation.farmId ?? context.farmId, fieldId: observation.fieldId ?? context.fieldId, priority: 'low', category: 'monitoring', title: 'Continue monitoring this area', message: 'A field check was recorded for this observation.', action: 'Review this area again during normal field checks.', reason: 'The farmer recorded a field check; the original AI result remains unchanged.', sourceObservationIds: [observation.id], sourceEvidenceIds: allMatchingEvidence.map((item) => item.id), sourceSensorReadingIds: [], verificationState: 'verified', ruleId: 'verified-monitoring' });
      continue;
    }
    if (observation.scanStatus === 'uncertain' || (observation.scanStatus === 'possible_issue' && (observation.confidence ?? 0) < minimumConfidence)) {
      const id = emit({ identity: observation.id, farmId: observation.farmId ?? context.farmId, fieldId: observation.fieldId ?? context.fieldId, priority: 'low', category: 'inspection', title: 'AI result is uncertain', message: 'This screening result needs a clearer image or another look.', action: 'Capture a clearer image or rescan the area.', reason: `The individual model confidence was ${formatPercent(observation.confidence)}; it is below the configured review threshold.`, sourceObservationIds: [observation.id], sourceEvidenceIds: [], sourceSensorReadingIds: [], verificationState: 'pending', ruleId: 'low-confidence-screening' });
      signal('possible_crop_health_issue', observation.condition, undefined, observation.source, observation.confidence, [observation.id], [], [], id);
      continue;
    }
    if (observation.scanStatus !== 'possible_issue' || observation.imageQuality !== 'acceptable') continue;
    const matchingEvidence = allMatchingEvidence.filter((item) => !['dismissed', 'verified'].includes(item.status));
    if (observation.verificationStatus !== 'requires_verification' || (observation.confidence ?? 0) < minimumConfidence) continue;
    const repeated = matchingEvidence.find((item) => item.observationCount >= 2);
    const evidence = repeated ? [repeated] : matchingEvidence;
    const sourceIds = repeated ? repeated.observationIds : [observation.id];
    const ruleId = repeated ? 'repeated-issue-inspection' : 'possible-issue-inspection';
    const key = emit({ identity: repeated ? `evidence:${repeated.id}` : observation.id, farmId: observation.farmId ?? context.farmId, fieldId: observation.fieldId ?? context.fieldId, zoneId: evidence[0]?.zoneId, priority: 'medium', category: repeated ? 'scouting' : 'inspection', title: repeated ? 'Inspect this zone' : 'Inspect affected area', message: repeated ? 'Similar possible crop-health observations were recorded more than once.' : 'A crop-health screening raised a possible issue.', action: repeated ? 'Inspect this zone and consider a clearer rescan.' : 'Inspect the affected area manually.', reason: repeated ? `${repeated.observationCount} separate observations of ${observation.crop ?? 'the crop'} / ${observation.condition ?? 'a similar condition'} are linked to this evidence record.` : `${observation.crop ?? 'A crop'} image was marked as a possible issue with ${formatPercent(observation.confidence)} confidence.`, sourceObservationIds: sourceIds, sourceEvidenceIds: evidence.map((item) => item.id), sourceSensorReadingIds: [], verificationState: 'pending', ruleId });
    signal('possible_crop_health_issue', observation.condition, undefined, observation.source, observation.confidence, sourceIds, evidence.map((item) => item.id), [], key);
  }

  const sensorKind = new Map((context.sensors ?? []).map((sensor) => [sensor.id, sensor.kind]));
  const latestBySensor = latestReadings(context.sensorReadings);
  for (const reading of latestBySensor) {
    if (reading.source === 'simulated') continue;
    const age = now - Date.parse(reading.receivedAt);
    if (!Number.isFinite(age) || age < 0) continue;
    if (age > freshnessMs) {
      const kind = sensorKind.get(reading.sensorId) ?? 'other';
      const ruleId = 'stale-sensor-reading';
      const key = emit({ identity: reading.sensorId, farmId: context.farmId, fieldId: context.fieldId, priority: 'low', category: 'system', title: 'Sensor reading is outdated', message: 'Refresh readings before using them for a decision.', action: 'Check the sensor connection and refresh readings.', reason: `The last ${kind} reading was received ${Math.round(age / 60_000)} minutes ago.`, sourceObservationIds: [], sourceEvidenceIds: [], sourceSensorReadingIds: [reading.id], verificationState: 'not_required', ruleId });
      signal('stale_sensor_data', age, 'ms', reading.source, undefined, [], [], [reading.id], key);
      continue;
    }
    if (reading.quality !== 'valid' || reading.value === undefined || !Number.isFinite(reading.value)) continue;
    const kind = sensorKind.get(reading.sensorId);
    if (kind === 'humidity' && context.rule?.enabled && context.rule.humidityAbovePct !== undefined && reading.value > context.rule.humidityAbovePct) {
      const key = emit({ identity: reading.sensorId, farmId: context.farmId, fieldId: context.fieldId, priority: 'low', category: 'environment', title: 'Monitor humidity conditions', message: `Humidity is ${reading.value}% RH, above this field's configured reference.`, action: 'Continue monitoring the field and review crop observations.', reason: `A valid current sensor reading exceeded the field rule reference of ${context.rule.humidityAbovePct}% RH.`, sourceObservationIds: [], sourceEvidenceIds: [], sourceSensorReadingIds: [reading.id], verificationState: 'not_required', ruleId: 'configured-humidity-reference' });
      signal('high_humidity', reading.value, '% RH', reading.source, undefined, [], [], [reading.id], key);
    }
    if (kind === 'soil_moisture' && context.rule?.enabled && context.rule.irrigationCheckEnabled && context.rule.soilRawBelow !== undefined && context.crop && reading.value < context.rule.soilRawBelow) {
      const key = emit({ identity: reading.sensorId, farmId: context.farmId, fieldId: context.fieldId, priority: 'low', category: 'irrigation_check', title: 'Check soil moisture before irrigation', message: `Raw soil sensor reading: ${reading.value} ADC counts.`, action: 'Check the soil and sensor calibration before deciding whether to irrigate.', reason: `A valid current raw reading is below the field's explicitly configured reference of ${context.rule.soilRawBelow} ADC counts. Raw values are not percentages.`, sourceObservationIds: [], sourceEvidenceIds: [], sourceSensorReadingIds: [reading.id], verificationState: 'not_required', ruleId: 'configured-soil-raw-reference' });
      signal('low_soil_moisture', reading.value, 'ADC count', reading.source, undefined, [], [], [reading.id], key);
    }
    if (kind === 'temperature' && context.rule?.enabled && context.rule.temperatureAboveC !== undefined && reading.value > context.rule.temperatureAboveC) {
      const key = emit({ identity: reading.sensorId, farmId: context.farmId, fieldId: context.fieldId, priority: 'low', category: 'environment', title: 'Monitor temperature conditions', message: `Temperature is ${reading.value}°C, above this field's configured reference.`, action: 'Check the field and review crop observations.', reason: `A valid current sensor reading exceeded the field rule reference of ${context.rule.temperatureAboveC}°C.`, sourceObservationIds: [], sourceEvidenceIds: [], sourceSensorReadingIds: [reading.id], verificationState: 'not_required', ruleId: 'configured-temperature-reference' });
      signal('high_temperature', reading.value, '°C', reading.source, undefined, [], [], [reading.id], key);
    }
    if (kind === 'rain' && context.rule?.enabled && context.rule.rainRawThreshold !== undefined && context.rule.rainRawActiveWhen
      && (context.rule.rainRawActiveWhen === 'below' ? reading.value < context.rule.rainRawThreshold : reading.value > context.rule.rainRawThreshold)) {
      const key = emit({ identity: reading.sensorId, farmId: context.farmId, fieldId: context.fieldId, priority: 'low', category: 'environment', title: 'Check the rain sensor reading', message: `Rain sensor raw reading: ${reading.value} ADC counts. This is not a rainfall amount.`, action: 'Check conditions in the field; do not treat this raw reading as rainfall amount.', reason: `The valid current raw value crossed the explicitly configured sensor reference of ${context.rule.rainRawThreshold} ADC counts.`, sourceObservationIds: [], sourceEvidenceIds: [], sourceSensorReadingIds: [reading.id], verificationState: 'not_required', ruleId: 'configured-rain-raw-reference' });
      signal('recent_rain', reading.value, 'ADC count', reading.source, undefined, [], [], [reading.id], key);
    }
  }
  return {
    advisories: [...new Map(advisories.map((item) => [item.deduplicationKey, item])).values()],
    riskSignals: [...new Map(riskSignals.map((item) => [item.id, item])).values()],
  };
}

function latestReadings(readings: SensorReading[]) {
  const latest = new Map<string, SensorReading>();
  for (const reading of readings) { const prior = latest.get(reading.sensorId); if (!prior || reading.receivedAt > prior.receivedAt) latest.set(reading.sensorId, reading); }
  return [...latest.values()];
}
function formatPercent(value?: number) { return value === undefined || !Number.isFinite(value) ? 'unavailable' : `${Math.round(value * 100)}%`; }
function dedupKey(fieldId: string | undefined, zoneId: string | undefined, observationIds: string[], category: Advisory['category'], ruleId: string, identity = '') { return [fieldId ?? 'unassigned', zoneId ?? (identity || observationIds.slice().sort().join(',')), category, ruleId].join(':'); }
function hash(value: string) { let h = 2166136261; for (const char of value) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
