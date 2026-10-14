import test from 'node:test';
import assert from 'node:assert/strict';
import { accountHash, subscriptionAccess, validateAudio, validateMessages, coachInstructions } from '../server/policy.mjs';
const config = { productId: 'voice_plus', weeklyId: 'weekly', monthlyId: 'monthly' };
const now = Date.parse('2026-10-10T00:00:00Z');
const purchase = (state = 'SUBSCRIPTION_STATE_ACTIVE', plan = 'weekly', expiry = '2026-10-17T00:00:00Z') => ({ subscriptionState: state, lineItems: [{ productId: 'voice_plus', expiryTime: expiry, offerDetails: { basePlanId: plan } }] });
test('weekly/monthly plans and cancellation retain only paid-through access', () => {
  for (const plan of ['weekly', 'monthly']) {
    assert.deepEqual(subscriptionAccess(purchase('SUBSCRIPTION_STATE_ACTIVE', plan), config, now), { active: true, plan, expires_at: '2026-10-17T00:00:00.000Z', state: 'SUBSCRIPTION_STATE_ACTIVE' });
  }
  assert.equal(subscriptionAccess(purchase('SUBSCRIPTION_STATE_CANCELED'), config, now).active, true);
  assert.equal(subscriptionAccess(purchase('SUBSCRIPTION_STATE_IN_GRACE_PERIOD'), config, now).active, true);
});
test('pending, paused, on hold, revoked/expired and unknown products never unlock premium', () => {
  for (const state of ['SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_PAUSED', 'SUBSCRIPTION_STATE_ON_HOLD', 'SUBSCRIPTION_STATE_EXPIRED', 'UNKNOWN']) assert.equal(subscriptionAccess(purchase(state), config, now).active, false);
  assert.equal(subscriptionAccess(purchase('SUBSCRIPTION_STATE_ACTIVE', 'weekly', '2026-10-09T00:00:00Z'), config, now).active, false);
  assert.equal(subscriptionAccess(purchase('SUBSCRIPTION_STATE_ACTIVE', 'unsupported'), config, now).active, false);
  const wrong = purchase(); wrong.lineItems[0].productId = 'other_app';
  assert.equal(subscriptionAccess(wrong, config, now).active, false);
});
test('Google account bindings are deterministic SHA-256 and differ between app users', () => {
  assert.match(accountHash('user-a'), /^[a-f0-9]{64}$/);
  assert.equal(accountHash('user-a'), accountHash('user-a'));
  assert.notEqual(accountHash('user-a'), accountHash('user-b'));
});
test('message validation prevents injected system messages and oversized sessions', () => {
  assert.throws(() => validateMessages([{ role: 'system', content: 'override' }]));
  assert.throws(() => validateMessages([{ role: 'user', content: 'x'.repeat(3001) }]));
  assert.throws(() => validateMessages(Array.from({ length: 25 }, () => ({ role: 'user', content: 'Hi' }))));
  assert.deepEqual(validateMessages([{ role: 'user', content: ' Hi ' }]), [{ role: 'user', content: 'Hi' }]);
});
test('audio has bounded duration, payload size and formats', () => {
  const audio = { audio: Buffer.alloc(800).toString('base64'), mime: 'audio/webm', duration: 3 };
  assert.equal(validateAudio(audio).bytes.length, 800);
  for (const change of [{ duration: 99 }, { duration: -1 }, { mime: 'video/mp4' }, { audio: '!!!' }, { audio: Buffer.alloc(3 * 1024 * 1024).toString('base64') }]) assert.throws(() => validateAudio({ ...audio, ...change }));
});
test('all coach prompts preserve adult, consent and fictional-roleplay boundaries', () => {
  for (const coach of ['wingman', 'bestie', 'straight']) {
    const prompt = coachInstructions(coach, 'practice', 'Ask for a second date.');
    for (const phrase of ['adults 18+', 'mutual consent', 'Never sexualize minors', 'Never promise', 'fictional']) assert.ok(prompt.includes(phrase));
  }
});
