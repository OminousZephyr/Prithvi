import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateInspectionAlert } from '../../src/features/observations/inspection-alert-evaluator.ts';

const base = { id: 'obs-1', kind: 'crop_health', title: 'Possible crop-health issue', observedAt: '2026-08-20T12:00:00.000Z', source: 'esp32_cam_rgb', confidence: 0.8, evidence: [], verificationStatus: 'requires_verification', syncState: 'local', scanStatus: 'possible_issue', provenance: ['on_device_ai'] };

test('creates a medium-priority inspection reminder for a real supported possible issue', () => {
  const alert = evaluateInspectionAlert(base);
  assert.equal(alert.priority, 'medium');
  assert.equal(alert.type, 'crop_inspection');
  assert.equal(alert.status, 'active');
  assert.equal(alert.title, 'Inspection suggested');
  assert.match(alert.message, /Inspect the area manually/);
  assert.equal(alert.dedupeKey, 'crop_inspection:unassigned:observation:obs-1');
});

test('does not alert from uncertainty, low confidence, verified state, or simulated evidence', () => {
  assert.equal(evaluateInspectionAlert({ ...base, scanStatus: 'uncertain' }), undefined);
  assert.equal(evaluateInspectionAlert({ ...base, confidence: 0.4 }), undefined);
  assert.equal(evaluateInspectionAlert({ ...base, verificationStatus: 'verified' }), undefined);
  assert.equal(evaluateInspectionAlert({ ...base, source: 'simulated' }), undefined);
});
