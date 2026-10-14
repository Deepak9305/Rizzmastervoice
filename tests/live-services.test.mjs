import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, createGeminiLiveToken } from '../server/services.mjs';

test('Gemini Live tokens use the constrained endpoint and voice-safe setup', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return Response.json({ name: 'authTokens/test-token' });
  };
  try {
    const config = configuration({ GEMINI_API_KEY: 'test-key', GEMINI_LIVE_MODEL: 'models/gemini-3.8-live' });
    assert.equal(config.geminiLiveModel, 'gemini-3.8-live');
    assert.equal(await createGeminiLiveToken(config, 'coach instructions'), 'authTokens/test-token');
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/auth_tokens');
    assert.equal(request.init.headers['x-goog-api-key'], 'test-key');
    assert.equal(request.body.liveConnectConstraints.model, 'models/gemini-3.8-live');
    assert.deepEqual(request.body.liveConnectConstraints.config.responseModalities, ['AUDIO']);
    assert.deepEqual(request.body.liveConnectConstraints.config.inputAudioTranscription, {});
    assert.deepEqual(request.body.liveConnectConstraints.config.outputAudioTranscription, {});
    assert.equal(request.body.liveConnectConstraints.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
