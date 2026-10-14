import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../server/handler.mjs';
import { HttpError, TERMS_VERSION } from '../server/policy.mjs';
const userId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-000000000002';
const token = `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.signature`;
const profile = { user_id: userId, coach: 'wingman', age_confirmed: true, terms_version: TERMS_VERSION, voice_consent: true, spoken_replies: true };
function fixture(options = {}) {
  const calls = [];
  const db = {
    auth: {
      getUser: async () => ({ data: { user: { id: userId, email: 'test@example.invalid' } }, error: null }),
      signInWithPassword: async () => ({ data: {}, error: new Error('wrong password') }),
      admin: { signOut: async () => { calls.push('signout'); return { error: null }; }, deleteUser: async () => { calls.push('delete-user'); return { error: null }; } },
    },
    rpc: async name => {
      calls.push(name);
      return { data: name === 'voice_session_active' ? options.sessionActive !== false : { allowed: options.quota !== false, used: 1, limit: 5 }, error: null };
    },
    from: table => {
      const chain = {
        select() { return this; }, eq() { return this; },
        update(value) { calls.push(['update', table, value]); return this; },
        insert(value) { calls.push(['insert', table, value]); return this; },
        maybeSingle: async () => ({ data: table === 'voice_profiles' ? { ...profile, ...options.profile } : options.owner ? { user_id: options.owner } : null, error: null }),
        single: async () => ({ data: {}, error: options.insertRace ? { code: '23505' } : null }),
      }; return chain;
    },
  };
  let moderationCount = 0;
  const handler = createHandler({
    configuration: () => ({ origins: ['https://localhost'], openaiKey: 'test-only', geminiKey: options.gemini ? 'test-only' : undefined, geminiLiveModel: 'gemini-3.8-live', publicUrl: 'https://app.example.invalid' }),
    database: () => db,
    entitlement: async () => ({ active: options.premium || false }),
    moderate: async () => { calls.push('moderate'); moderationCount++; if (options.moderationError) throw new HttpError(502, 'Moderation unavailable'); return options.blockInput ? true : options.blockOutput && moderationCount === 2; },
    openai: async (_config, path) => { calls.push(path); return Response.json({ choices: [{ message: { content: 'Respect boundaries and be yourself.' } }] }); },
    createGeminiLiveToken: async (_config, instruction) => { calls.push(['gemini-token', instruction]); return 'token-name'; },
  });
  const request = (path, body, headers = {}) => handler(new Request(`https://app.example.invalid/api/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  return { request, calls };
}
const advice = { messages: [{ role: 'user', content: 'How do I introduce myself?' }], coach: 'wingman', mode: 'advice' };
test('missing and revoked authentication rejected before provider calls', async () => {
  let f = fixture(); assert.equal((await f.request('coach', advice, { authorization: '' })).status, 401); assert.equal(f.calls.length, 0);
  f = fixture({ sessionActive: false }); assert.equal((await f.request('coach', advice)).status, 401); assert.ok(!f.calls.includes('chat/completions'));
});
test('unknown origins rejected', async () => {
  const f = fixture(); assert.equal((await f.request('coach', advice, { origin: 'https://untrusted.invalid' })).status, 403); assert.equal(f.calls.length, 0);
});
test('adult consent and premium access enforced on server', async () => {
  const underage = fixture({ profile: { age_confirmed: false } }); assert.equal((await underage.request('coach', advice)).status, 403);
  const premium = fixture(); assert.equal((await premium.request('coach', { ...advice, coach: 'bestie' })).status, 402);
  assert.ok(!premium.calls.includes('voice_reserve_turn'));
  const audio = { audio: Buffer.alloc(800).toString('base64'), duration: 2, mime: 'audio/webm', voice_consent: false };
  const noConsent = fixture(); assert.equal((await noConsent.request('coach', { ...advice, ...audio })).status, 403);
  assert.ok(!noConsent.calls.includes('audio/transcriptions'));
});
test('exhausted quota blocks paid transcription and model work', async () => {
  const f = fixture({ quota: false });
  const response = await f.request('coach', { ...advice, audio: Buffer.alloc(800).toString('base64'), duration: 2, mime: 'audio/webm', voice_consent: true });
  assert.equal(response.status, 429); assert.ok(!f.calls.includes('audio/transcriptions')); assert.ok(!f.calls.includes('moderate'));
});
test('input/output moderation and outages fail safely', async () => {
  const input = fixture({ blockInput: true }); const inputResponse = await input.request('coach', advice);
  assert.equal(inputResponse.status, 200); assert.ok(!input.calls.includes('chat/completions')); assert.match((await inputResponse.json()).reply, /mutual consent/);
  const output = fixture({ blockOutput: true }); assert.match((await (await output.request('coach', advice)).json()).reply, /safer approach/);
  const unavailable = fixture({ moderationError: true }); assert.equal((await unavailable.request('coach', advice)).status, 502); assert.ok(!unavailable.calls.includes('chat/completions'));
});
test('healthy coaching checks quota before moderation then model and output check', async () => {
  const f = fixture(); assert.equal((await f.request('coach', advice)).status, 200);
  assert.deepEqual(f.calls, ['voice_session_active', 'voice_reserve_turn', 'moderate', 'chat/completions', 'moderate']);
});
test('live sessions use a constrained token and reserve each turn', async () => {
  const f = fixture({ gemini: true });
  const tokenResponse = await f.request('live-token', { coach: 'wingman', mode: 'advice', voice: false });
  assert.equal(tokenResponse.status, 200);
  assert.equal((await tokenResponse.json()).token, 'token-name');
  assert.equal(f.calls.find(call => Array.isArray(call))?.[0], 'gemini-token');
  const turnResponse = await f.request('live-turn', { coach: 'wingman', mode: 'advice', voice: true });
  assert.equal(turnResponse.status, 200);
  assert.ok(f.calls.includes('voice_reserve_turn'));
});
const saved = { id: sessionId, title: 'Example', mode: 'advice', coach: 'wingman', messages: [...advice.messages, { role: 'assistant', content: 'Hello' }] };
test('session save rejects another owner and primary-key races never overwrite', async () => {
  const other = fixture({ owner: '00000000-0000-4000-8000-000000000009' });
  assert.equal((await other.request('sessions', saved)).status, 403); assert.ok(!other.calls.some(c => Array.isArray(c)));
  const race = fixture({ insertRace: true }); assert.equal((await race.request('sessions', saved)).status, 409);
  assert.equal(race.calls.find(c => Array.isArray(c))[0], 'insert');
  const own = fixture({ owner: userId }); assert.equal((await own.request('sessions', saved)).status, 200); assert.equal(own.calls.find(c => Array.isArray(c))[0], 'update');
  const record = own.calls.find(c => Array.isArray(c))[2];
  assert.match(record.messages[0].id, /^[a-f0-9-]{36}$/); assert.equal(record.scenario, 'intro');
});
test('incorrect password cannot delete an account', async () => {
  const f = fixture();
  const response = await createHandler({ configuration: () => ({ origins: [] }), database: () => ({ ...{}, auth: { getUser: async () => ({ data: { user: { id: userId } } }) }, rpc: async () => ({ data: true }) }) })(new Request('https://example.invalid/api/account', { method:'DELETE', headers:{authorization:''} }));
  assert.equal(response.status, 401);
  // Invoke the full fixture as DELETE without weakening its auth/database checks.
  const handler = createHandler({ configuration: () => ({ origins: [] }), database: () => ({ auth: { getUser: async () => ({ data: { user: { id: userId, email:'test@example.invalid' } } }), signInWithPassword: async () => ({ error:new Error('incorrect'),data:{} }), admin: { deleteUser: async () => { throw new Error('must not delete'); } } }, rpc: async () => ({ data:true }), from: () => ({ select() {return this;}, eq() {return this;}, maybeSingle:async () => ({data:profile}) }) }) });
  const denied = await handler(new Request('https://example.invalid/api/account', {method:'DELETE', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({confirmation:'DELETE',password:'incorrect'})}));
  assert.equal(denied.status,403);
});
