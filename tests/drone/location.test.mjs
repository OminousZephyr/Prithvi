import assert from 'node:assert/strict';
import test from 'node:test';

import { ObservationLocationService } from '../../src/features/observations/observation-location.ts';
import { DroneGpsLocationProvider } from '../../src/features/drone/drone-location-provider.ts';
import { DroneRepository } from '../../src/features/drone/drone-repository.ts';
import { parseTelemetryJson } from '../../src/features/drone/telemetry-parser.ts';

const now = new Date().toISOString();
function store() { const data = new Map(); return { async list(type) { return [...data.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); }, async save(type, value) { data.set(`${type}:${value.id}`, value); return value; } }; }

test('uses fresh valid drone GPS first and never substitutes a fallback when it is unavailable', async () => {
  const db = store(); const repo = new DroneRepository(db);
  await repo.recordTelemetry(parseTelemetryJson({ drone_id: 'real', connection: 'connected', latitude: 12.4, longitude: 76.2, gps_fix: 3 }, now));
  let fallbackCalls = 0;
  const service = new ObservationLocationService(new DroneGpsLocationProvider(repo), { async getLocation() { fallbackCalls += 1; return { point: { latitude: 1, longitude: 2 }, source: 'manual', observedAt: now }; } });
  const fix = await service.getCurrentFix(); assert.equal(fix.source, 'drone'); assert.equal(fix.point.latitude, 12.4); assert.equal(fallbackCalls, 0);
});
test('does not use missing, invalid, stale, or no-fix drone GPS', async () => {
  for (const payload of [
    { drone_id: 'real', connection: 'connected', latitude: null, longitude: null, gps_fix: 3 },
    { drone_id: 'real', connection: 'connected', latitude: 12.4, longitude: 76.2, gps_fix: 0 },
    { drone_id: 'real', connection: 'disconnected', latitude: 12.4, longitude: 76.2, gps_fix: 3 },
  ]) {
    const db = store(); const repo = new DroneRepository(db); await repo.recordTelemetry(parseTelemetryJson(payload, now));
    assert.equal(await new DroneGpsLocationProvider(repo).getLocation(), undefined);
  }
});
