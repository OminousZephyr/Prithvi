import type { Advisory, AdvisoryCategory, AdvisoryContext, AdvisoryRule, AdvisoryStatus, CropObservation, Farm, Field, RiskSignal, ScoutingEvidence, Sensor, SensorCalibration, SensorNode, SensorReading } from '@/domain/models';
import { DEFAULT_ADVISORY_VALIDITY_MS, DEFAULT_SENSOR_FRESHNESS_MS, evaluateAdvisoryContext } from './advisory-engine.ts';

export interface AdvisoryStore {
  list<T>(type: string): Promise<T[]>;
  get?<T>(type: string, id: string): Promise<T | undefined>;
  save<T extends { id: string }>(type: string, value: T): Promise<T>;
}
export interface AdvisoryFilters { farmId?: string; fieldId?: string; category?: AdvisoryCategory; status?: AdvisoryStatus; from?: string; to?: string }

export class AdvisoryRepository {
  private readonly store: AdvisoryStore;
  constructor(store: AdvisoryStore) { this.store = store; }

  async refresh(now = new Date().toISOString()): Promise<Advisory[]> {
    const nowMs = Date.parse(now);
    const [oldAdvisories, fields, farms, observations, evidence, readings, sensors, nodes, rules, calibrations] = await Promise.all([
      this.store.list<Advisory>('advisory'), this.store.list<Field>('field'), this.store.list<Farm>('farm'),
      this.store.list<CropObservation>('crop-observation'), this.store.list<ScoutingEvidence>('scouting-evidence'),
      this.store.list<SensorReading>('sensor-reading'), this.store.list<Sensor>('sensor'), this.store.list<SensorNode>('sensor-node'),
      this.store.list<AdvisoryRule>('advisory-rule'), this.store.list<SensorCalibration>('sensor-calibration'),
    ]);
    let advisories = oldAdvisories;
    for (const old of oldAdvisories) {
      if (['active', 'acknowledged'].includes(old.status) && old.expiresAt && Date.parse(old.expiresAt) <= nowMs) {
        const expired = { ...old, status: 'expired' as const, updatedAt: now, syncState: 'local' as const };
        await this.store.save('advisory', expired);
        advisories = advisories.map((item) => item.id === old.id ? expired : item);
      }
    }
    const observationById = new Map(observations.map((item) => [item.id, item]));
    for (const existing of advisories.filter((item) => ['active', 'acknowledged'].includes(item.status))) {
      const linked = existing.sourceObservationIds.map((id) => observationById.get(id)).filter((item): item is CropObservation => !!item);
      if (linked.length && linked.every((item) => item.verificationStatus === 'dismissed' || item.verificationStatus === 'verified')) {
        const dismissed = linked.some((item) => item.verificationStatus === 'dismissed');
        const updated = { ...existing, status: 'resolved' as const, verificationState: dismissed ? 'dismissed' as const : 'verified' as const, updatedAt: now };
        await this.store.save('advisory', updated);
        advisories = advisories.map((item) => item.id === existing.id ? updated : item);
      }
    }

    const sensorFields = new Map<string, string>();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const sensor of sensors) { const fieldId = nodeById.get(sensor.nodeId)?.fieldId; if (fieldId) sensorFields.set(sensor.id, fieldId); }
    for (const field of fields) {
      const farm = farms.find((item) => item.id === field.farmId);
      const rule = rules.find((item) => item.fieldId === field.id && item.enabled && (!item.crop || item.crop.toLocaleLowerCase() === field.crop?.name.toLocaleLowerCase()) && (!item.growthStage || item.growthStage.toLocaleLowerCase() === field.crop?.growthStage?.toLocaleLowerCase()));
      const fieldReadings = readings.filter((reading) => sensorFields.get(reading.sensorId) === field.id);
      const context: AdvisoryContext = {
        fieldId: field.id, farmId: farm?.id, crop: field.crop?.name, variety: field.crop?.variety, growthStage: field.crop?.growthStage,
        observations: observations.filter((item) => item.fieldId === field.id), evidence: evidence.filter((item) => item.fieldId === field.id),
        sensorReadings: fieldReadings, sensors: sensors.filter((sensor) => sensorFields.get(sensor.id) === field.id),
        sensorNodes: nodes.filter((node) => node.fieldId === field.id), calibrations: calibrations.filter((calibration) => sensors.some((sensor) => sensor.calibrationId === calibration.id && sensorFields.get(sensor.id) === field.id)),
        rule, now,
      };
      const evaluation = evaluateAdvisoryContext(context);
      for (const signal of evaluation.riskSignals) await this.store.save('risk-signal', signal);
      for (const generated of evaluation.advisories) {
        const prior = advisories.find((item) => item.deduplicationKey === generated.deduplicationKey);
        if (prior) {
          if (prior.status === 'active' || prior.status === 'acknowledged') {
            const updated = { ...prior, title: generated.title, message: generated.message, action: generated.action, reason: generated.reason, sourceObservationIds: generated.sourceObservationIds, sourceEvidenceIds: generated.sourceEvidenceIds, sourceSensorReadingIds: generated.sourceSensorReadingIds, zoneId: generated.zoneId ?? prior.zoneId, updatedAt: now };
            await this.store.save('advisory', updated);
            advisories = advisories.map((item) => item.id === prior.id ? updated : item);
          }
          continue;
        }
        await this.store.save('advisory', generated);
        advisories.push(generated);
      }
    }
    await this.resolveStaleSensorAdvice(advisories, sensorFields, readings, rules, now);
    return this.store.list<Advisory>('advisory');
  }

  async list(filters: AdvisoryFilters = {}) {
    let values = await this.refresh();
    const from = filters.from ? dateBound(filters.from, false) : undefined;
    const to = filters.to ? dateBound(filters.to, true) : undefined;
    return values.filter((item) => (!filters.farmId || item.farmId === filters.farmId) && (!filters.fieldId || item.fieldId === filters.fieldId)
      && (!filters.category || item.category === filters.category) && (!filters.status || item.status === filters.status)
      && (!from || item.createdAt >= from) && (!to || item.createdAt <= to))
      .sort((a, b) => (b.createdAt).localeCompare(a.createdAt));
  }

  async listForObservation(observationId: string) {
    const [advisories, evidence] = await Promise.all([this.refresh(), this.store.list<ScoutingEvidence>('scouting-evidence')]);
    const evidenceIds = new Set(evidence.filter((item) => item.observationIds.includes(observationId)).map((item) => item.id));
    return advisories.filter((item) => item.sourceObservationIds.includes(observationId) || item.sourceEvidenceIds.some((id) => evidenceIds.has(id)));
  }

  async setStatus(id: string, status: AdvisoryStatus) {
    const current = await this.store.get?.<Advisory>('advisory', id) ?? (await this.store.list<Advisory>('advisory')).find((item) => item.id === id);
    if (!current) return undefined;
    return this.store.save('advisory', { ...current, status, updatedAt: new Date().toISOString(), syncState: 'local' });
  }

  async saveRule(rule: AdvisoryRule) {
    const thresholds = [rule.soilRawBelow, rule.humidityAbovePct, rule.temperatureAboveC, rule.rainRawThreshold, rule.minimumConfidence, rule.staleAfterMs, rule.validForMs].filter((value) => value !== undefined);
    if (thresholds.some((value) => !Number.isFinite(value)) || (rule.minimumConfidence !== undefined && (rule.minimumConfidence < 0 || rule.minimumConfidence > 1)) || (rule.staleAfterMs !== undefined && rule.staleAfterMs <= 0) || (rule.validForMs !== undefined && rule.validForMs <= 0)) throw new Error('Advisory rule values must be finite and durations/confidence must be in range.');
    return this.store.save('advisory-rule', { ...rule, updatedAt: new Date().toISOString() });
  }
  async listRules(fieldId?: string) { return (await this.store.list<AdvisoryRule>('advisory-rule')).filter((item) => !fieldId || item.fieldId === fieldId); }

  async recordLowImageQuality(input: { fieldId?: string; farmId?: string; capturedAt?: string; source: CropObservation['source']; imageReference?: string }) {
    const createdAt = input.capturedAt ?? new Date().toISOString();
    const identity = hash(`${input.imageReference ?? 'no-image-reference'}:${createdAt}`);
    const key = [input.fieldId ?? 'unassigned', `image:${identity}`, 'image_quality', 'image-quality-low'].join(':');
    const existing = (await this.store.list<Advisory>('advisory')).find((item) => item.deduplicationKey === key);
    if (existing) return existing;
    const advisory: Advisory = { id: `advisory-${hash(key)}`, farmId: input.farmId, fieldId: input.fieldId, createdAt, updatedAt: createdAt, priority: 'low', category: 'image_quality', title: 'Capture a clearer image', message: 'The image quality was too low for crop screening.', action: 'Take a clearer close-up and try again.', reason: 'Image-quality checks did not pass; no AI observation was created.', sourceObservationIds: [], sourceEvidenceIds: [], sourceSensorReadingIds: [], verificationState: 'not_required', status: 'active', expiresAt: new Date(Date.parse(createdAt) + DEFAULT_ADVISORY_VALIDITY_MS).toISOString(), ruleId: 'image-quality-low', deduplicationKey: key, syncState: 'local' };
    await this.store.save('advisory', advisory);
    if (input.fieldId) {
      const signal: RiskSignal = { id: `risk-${hash(key)}`, fieldId: input.fieldId, farmId: input.farmId, createdAt, type: 'low_image_quality', source: input.source, validUntil: advisory.expiresAt, evidenceReference: {}, ruleId: 'image-quality-low', syncState: 'local' };
      await this.store.save('risk-signal', signal);
    }
    return advisory;
  }

  private async resolveStaleSensorAdvice(advisories: Advisory[], sensorFields: Map<string, string>, readings: SensorReading[], rules: AdvisoryRule[], now: string) {
    const latest = new Map<string, SensorReading>();
    for (const item of readings) { const prior = latest.get(item.sensorId); if (!prior || item.receivedAt > prior.receivedAt) latest.set(item.sensorId, item); }
    for (const advisory of advisories.filter((item) => item.ruleId === 'stale-sensor-reading' && ['active', 'acknowledged'].includes(item.status))) {
      const sensorIds = new Set(advisory.sourceSensorReadingIds.map((id) => readings.find((reading) => reading.id === id)?.sensorId).filter((id): id is string => !!id));
      const fresh = [...sensorIds].some((sensorId) => {
        const reading = latest.get(sensorId);
        const staleAfterMs = rules.find((rule) => rule.fieldId === advisory.fieldId)?.staleAfterMs ?? DEFAULT_SENSOR_FRESHNESS_MS;
        return sensorFields.get(sensorId) === advisory.fieldId && reading?.quality === 'valid' && Number.isFinite(reading.value) && Date.parse(now) - Date.parse(reading.receivedAt) <= staleAfterMs;
      });
      if (fresh) await this.setStatus(advisory.id, 'resolved');
    }
  }
}

function dateBound(value: string, end: boolean) { return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : value; }
function hash(value: string) { let h = 2166136261; for (const char of value) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
