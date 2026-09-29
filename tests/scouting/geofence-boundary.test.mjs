import assert from 'node:assert/strict';
import test from 'node:test';

import { isValidFieldBoundary, pointInFieldBoundary } from '../../src/features/scouting/field-geometry.ts';
import { evaluateFieldGeofence } from '../../src/features/scouting/geofence.ts';
import { resolveObservationField } from '../../src/features/observations/observation-context.ts';
import { ScoutingRepository } from '../../src/features/scouting/scouting-repository.ts';
import { translate } from '../../src/localization/resources.ts';

const boundary = [
  { latitude: 12, longitude: 76 }, { latitude: 12, longitude: 76.001 },
  { latitude: 12.001, longitude: 76.001 }, { latitude: 12.001, longitude: 76 },
];
const field = { id: 'field-1', farmId: 'farm-1', name: 'North field', boundary, sensorNodeIds: [], observationIds: [], healthStatus: 'unassessed', createdAt: '2026-01-01T00:00:00Z', syncState: 'local' };

test('field boundary accepts a valid polygon and rejects too few, invalid, and crossing points', () => {
  assert.equal(isValidFieldBoundary(boundary), true);
  assert.equal(isValidFieldBoundary(boundary.slice(0, 2)), false);
  assert.equal(isValidFieldBoundary([{ ...boundary[0], latitude: 91 }, ...boundary.slice(1)]), false);
  const crossing = [{ latitude: 0, longitude: 0 }, { latitude: 2, longitude: 2 }, { latitude: 0, longitude: 2 }, { latitude: 3, longitude: 0 }];
  assert.equal(isValidFieldBoundary(crossing), false);
});

test('point-in-polygon recognizes inside and outside positions and counts an edge as inside', () => {
  assert.equal(pointInFieldBoundary({ latitude: 12.0005, longitude: 76.0005 }, boundary), true);
  assert.equal(pointInFieldBoundary({ latitude: 12.002, longitude: 76.002 }, boundary), false);
  assert.equal(pointInFieldBoundary({ latitude: 12, longitude: 76.0005 }, boundary), true);
});

test('geofence returns inside, outside, or unknown without inferring danger', () => {
  assert.equal(evaluateFieldGeofence(boundary, { latitude: 12.0005, longitude: 76.0005 }), 'inside');
  assert.equal(evaluateFieldGeofence(boundary, { latitude: 12.002, longitude: 76.002 }), 'outside');
  assert.equal(evaluateFieldGeofence(boundary, undefined), 'unknown');
  assert.equal(evaluateFieldGeofence(boundary, { latitude: 91, longitude: 76 }), 'unknown');
  assert.equal(evaluateFieldGeofence(undefined, { latitude: 12, longitude: 76 }), 'unknown');
});

test('automatic field association requires containment while a manual field selection is preserved', () => {
  const inside = { latitude: 12.0005, longitude: 76.0005 };
  const outside = { latitude: 12.002, longitude: 76.002 };
  assert.equal(resolveObservationField(inside, [field])?.id, field.id);
  assert.equal(resolveObservationField(outside, [field]), undefined);
  assert.equal(resolveObservationField(outside, [field], field.id)?.id, field.id);
});

test('field map data remains available from local records without a network provider', async () => {
  const records = new Map([['field:field-1', field]]);
  const store = {
    async list(type) { return [...records.entries()].filter(([key]) => key.startsWith(`${type}:`)).map(([, value]) => value); },
    async get(type, id) { return records.get(`${type}:${id}`); },
    async save(type, value) { records.set(`${type}:${value.id}`, value); return value; },
  };
  const result = await new ScoutingRepository(store).getMapData(field.id);
  assert.deepEqual(result.field.boundary, boundary);
  assert.deepEqual(result.observations, []);
  assert.equal(result.dronePosition, undefined);
});

test('field boundary, geofence, and health-summary labels have English and Hindi translations', () => {
  for (const key of ['fieldBoundary', 'drawBoundary', 'saveBoundary', 'droneInsideField', 'droneOutsideField', 'fieldPositionUnavailable', 'fieldHealthyLooking', 'fieldPossibleIssues', 'fieldInspectionZones', 'fieldPendingRescans']) {
    assert.ok(translate('en', key)); assert.ok(translate('hi', key));
  }
});
