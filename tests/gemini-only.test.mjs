import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../server/handler.mjs';

test('Gemini-only test mode mints a Live token without Supabase', async () => {
  const calls = [];
  const handler = createHandler({
    configuration: () => ({
      origins: ['https://app.example.invalid'],
      geminiKey: 'test-only',
      geminiLiveModel: 'gemini-3.8-live',
      geminiOnlyMode: true,
    }),
    createGeminiLiveToken: async (_config, instruction) => { calls.push(instruction); return 'authTokens/test'; },
  });
  const request = (path, body) => handler(new Request(`https://app.example.invalid/api/${path}`, {
    method: 'POST',
    headers: { origin: 'https://app.example.invalid', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
  const token = await request('live-token', { coach: 'wingman', mode: 'advice', voice: true });
  assert.equal(token.status, 200);
  assert.deepEqual(await token.json(), { token: 'authTokens/test', model: 'gemini-3.8-live', used: 0, limit: 5 });
  assert.equal(calls.length, 1);
  const turn = await request('live-turn', { coach: 'wingman', mode: 'advice', voice: true });
  assert.equal(turn.status, 200);
  assert.deepEqual(await turn.json(), { used: 0, limit: 5 });
});
