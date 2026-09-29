import assert from 'node:assert/strict';
import test from 'node:test';
import { homeHeaderPresentation } from '../../src/features/dashboard/home-presentation.ts';

test('Home greets the signed-in farmer by saved display name in English and Hindi', () => {
  assert.equal(homeHeaderPresentation({ status: 'signed_in', displayName: 'Pranay' }, 'en').greeting, 'Hello, Pranay');
  assert.equal(homeHeaderPresentation({ status: 'signed_in', displayName: 'Pranay' }, 'hi').greeting, 'नमस्ते, Pranay');
  assert.equal(homeHeaderPresentation({ status: 'signed_in', displayName: 'Pranay' }, 'en').profileName, 'Pranay');
});

test('signed-out Home uses localized neutral farmer identity and compact avatar initial', () => {
  const en = homeHeaderPresentation({ status: 'offline_user', displayName: 'Old profile name' }, 'en');
  const hi = homeHeaderPresentation(undefined, 'hi');
  assert.equal(en.greeting, 'Hello, Farmer'); assert.equal(en.profileInitial, 'F');
  assert.equal(en.profileName, undefined);
  assert.equal(hi.greeting, 'नमस्ते, किसान'); assert.equal(hi.profileInitial, 'क');
  assert.equal(en.accessibleAccountLabel, 'Open account');
});
