import { randomUUID } from 'node:crypto';
import { configuration, database, openai, moderate, entitlement, verifyPurchase, verifyPush, createGeminiLiveToken } from './services.mjs';
import { HttpError, TERMS_VERSION, COACH_IDS, REPORT_REASONS, validateAudio, validateMessages, coachInstructions } from './policy.mjs';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const assert = (value, status, message) => { if (!value) throw new HttpError(status, message); };
async function bodyJson(request) {
  const raw = await request.text();
  assert(raw.length <= 3 * 1024 * 1024, 413, 'Please send a shorter message.');
  try { const body = JSON.parse(raw || '{}'); assert(body && typeof body === 'object' && !Array.isArray(body), 400, 'Invalid request.'); return body; }
  catch (error) { if (error.status) throw error; throw new HttpError(400, 'Invalid request.'); }
}
async function authenticated(request, db) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  assert(token, 401, 'Please sign in to continue.');
  const { data, error } = await db.auth.getUser(token);
  assert(!error && data.user, 401, 'Your session has expired. Please sign in again.');
  let sessionId;
  try { sessionId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).session_id; } catch { /* verified getUser above; malformed session rejected below */ }
  assert(typeof sessionId === 'string', 401, 'Please sign in again.');
  const { data: active, error: sessionError } = await db.rpc('voice_session_active', { p_user: data.user.id, p_session: sessionId });
  if (sessionError) throw sessionError;
  assert(active, 401, 'Your session has ended. Please sign in again.');
  return { user: data.user, token };
}
async function profileFor(db, user) {
  let { data, error } = await db.from('voice_profiles').select('*').eq('user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    const result = await db.from('voice_profiles').upsert({ user_id: user.id, display_name: String(user.user_metadata?.display_name || '').slice(0, 60) }, { onConflict: 'user_id', ignoreDuplicates: true }).select().maybeSingle();
    if (result.error) throw result.error;
    data = result.data || (await db.from('voice_profiles').select('*').eq('user_id', user.id).single()).data;
  }
  assert(data, 503, 'Your profile couldn’t load. Please try again.');
  return data;
}
export function createHandler(overrides = {}) {
  const services = { configuration, database, openai, moderate, entitlement, verifyPurchase, verifyPush, createGeminiLiveToken, ...overrides };
  return async function handler(request) {
    const config = services.configuration();
    const url = new URL(request.url);
    const path = (url.searchParams.get('path') || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
    const origin = request.headers.get('origin');
    const allowed = !origin || config.origins.includes(origin) || (config.publicUrl && origin === new URL(config.publicUrl).origin) || origin === url.origin;
    let result;
    try {
      assert(allowed, 403, 'This app origin is not allowed.');
      if (request.method === 'OPTIONS') result = new Response(null, { status: 204 });
      else if (path === 'health' && request.method === 'GET') result = json({ ok: true, configured: Boolean(config.supabaseUrl && config.supabaseKey && (config.openaiKey || config.geminiKey)) });
      else if (path === 'billing/notifications' && request.method === 'POST') {
        await services.verifyPush(config, request.headers.get('authorization')?.replace(/^Bearer /i, '') || '');
        const body = await bodyJson(request);
        assert(typeof body.message?.data === 'string', 400, 'Invalid notification.');
        let notice;
        try { notice = JSON.parse(Buffer.from(body.message.data, 'base64').toString()); } catch { throw new HttpError(400, 'Invalid notification.'); }
        assert(notice.packageName === config.packageName, 400, 'Wrong app.');
        if (!notice.testNotification) {
          const db = services.database(config);
          const token = notice.subscriptionNotification?.purchaseToken;
          if (token) {
            const { data: row, error } = await db.from('voice_purchases').select('user_id').eq('purchase_token', token).maybeSingle();
            if (error) throw error;
            if (row) await services.verifyPurchase(db, config, row.user_id, token);
            // Unknown new tokens are verified and bound on app purchase/restore.
          }
        }
        result = json({ ok: true });
      } else {
        const db = services.database(config);
        const { user, token } = await authenticated(request, db);
        const profile = await profileFor(db, user);
        if (path === 'profile' && request.method === 'GET') result = json({ profile, entitlement: await services.entitlement(db, config, user.id) });
        else if (path === 'profile' && request.method === 'PATCH') {
          const body = await bodyJson(request);
          const update = {};
          if (typeof body.display_name === 'string') update.display_name = body.display_name.trim().slice(0, 60);
          if (body.coach !== undefined) { assert(COACH_IDS.includes(body.coach), 400, 'Unknown coach.'); update.coach = body.coach; }
          for (const key of ['save_transcripts', 'spoken_replies', 'voice_consent']) if (body[key] !== undefined) { assert(typeof body[key] === 'boolean', 400, 'Invalid setting.'); update[key] = body[key]; }
          if (body.age_confirmed === true && body.accept_terms === true) { update.age_confirmed = true; update.terms_version = TERMS_VERSION; update.accepted_at = new Date().toISOString(); }
          const { data, error } = await db.from('voice_profiles').update(update).eq('user_id', user.id).select().single();
          if (error) throw error; result = json({ profile: data });
        } else if (path === 'live-token' && request.method === 'POST') {
          assert(profile.age_confirmed && profile.terms_version === TERMS_VERSION, 403, 'Confirm that you are 18 or older and accept the terms to start coaching.');
          assert(config.geminiKey, 503, 'Your live coach is being set up. Please try again later.');
          const body = await bodyJson(request);
          assert(body.voice !== true || profile.voice_consent, 403, 'Please agree to voice processing before starting a live session.');
          const coach = body.coach || profile.coach;
          assert(COACH_IDS.includes(coach), 400, 'Unknown coach.');
          assert(['advice', 'practice'].includes(body.mode), 400, 'Unknown session type.');
          const scenarios = { intro: 'Introduce yourself at a coffee shop.', second: 'Ask for a second date.', boundary: 'Set a boundary about texting.', rejection: 'Respond respectfully to rejection.' };
          assert(body.mode !== 'practice' || scenarios[body.scenario], 400, 'Choose a practice scenario.');
          const access = await services.entitlement(db, config, user.id);
          assert(access.active || (coach === 'wingman' && body.mode === 'advice'), 402, 'This coach or practice scenario is included with Voice Plus.');
          result = json({ token: await services.createGeminiLiveToken(config, coachInstructions(coach, body.mode, scenarios[body.scenario])), model: config.geminiLiveModel });
        } else if (path === 'live-turn' && request.method === 'POST') {
          assert(profile.age_confirmed && profile.terms_version === TERMS_VERSION, 403, 'Confirm that you are 18 or older and accept the terms to start coaching.');
          const body = await bodyJson(request);
          assert(body.voice !== true || profile.voice_consent, 403, 'Please agree to voice processing before starting a live session.');
          const coach = body.coach || profile.coach;
          assert(COACH_IDS.includes(coach), 400, 'Unknown coach.');
          assert(['advice', 'practice'].includes(body.mode), 400, 'Unknown session type.');
          const scenarios = { intro: 'Introduce yourself at a coffee shop.', second: 'Ask for a second date.', boundary: 'Set a boundary about texting.', rejection: 'Respond respectfully to rejection.' };
          assert(body.mode !== 'practice' || scenarios[body.scenario], 400, 'Choose a practice scenario.');
          const access = await services.entitlement(db, config, user.id);
          assert(access.active || (coach === 'wingman' && body.mode === 'advice'), 402, 'This coach or practice scenario is included with Voice Plus.');
          const { data: quota, error: quotaError } = await db.rpc('voice_reserve_turn', { p_user: user.id });
          if (quotaError) throw quotaError;
          assert(quota?.allowed, 429, 'You’ve used your coaching turns for today. Your allowance resets at midnight UTC.');
          result = json({ used: quota.used, limit: quota.limit });
        } else if (path === 'coach' && request.method === 'POST') {
          assert(profile.age_confirmed && profile.terms_version === TERMS_VERSION, 403, 'Confirm that you are 18 or older and accept the terms to start coaching.');
          assert(config.openaiKey, 503, 'Your coach is being set up. Please try again later.');
          const body = await bodyJson(request);
          const history = validateMessages(body.messages || []);
          const coach = body.coach || profile.coach;
          assert(COACH_IDS.includes(coach), 400, 'Unknown coach.');
          assert(['advice', 'practice'].includes(body.mode), 400, 'Unknown session type.');
          const access = await services.entitlement(db, config, user.id);
          assert(access.active || (coach === 'wingman' && (body.mode !== 'practice' || body.scenario === 'intro')), 402, 'This coach or practice scenario is included with Voice Plus.');
          const audio = body.audio ? validateAudio(body) : null;
          assert(!audio || (profile.voice_consent && body.voice_consent === true), 403, 'Please agree to voice processing before using the microphone.');
          const scenarios = { intro: 'Introduce yourself at a coffee shop.', second: 'Ask for a second date.', boundary: 'Set a boundary about texting.', rejection: 'Respond respectfully to rejection.' };
          assert(body.mode !== 'practice' || scenarios[body.scenario], 400, 'Choose a practice scenario.');
          if (!audio) assert(history.at(-1)?.role === 'user', 400, 'Please enter a message.');
          const { data: quota, error: quotaError } = await db.rpc('voice_reserve_turn', { p_user: user.id });
          if (quotaError) throw quotaError;
          assert(quota?.allowed, 429, 'You’ve used your coaching turns for today. Your allowance resets at midnight UTC.');
          // Reserve before ANY paid provider work, including transcription. Atomic DB quota.
          let text = '';
          if (audio) {
            const form = new FormData(); form.append('model', config.transcribeModel); form.append('file', new Blob([audio.bytes], { type: audio.mime }), `voice.${audio.extension}`);
            const response = await services.openai(config, 'audio/transcriptions', form, true);
            text = String((await response.json()).text || '').trim();
            assert(text && text.length <= 3000, 400, 'We couldn’t hear a clear message. Try again or use text.');
            history.push({ role: 'user', content: text });
          } else text = history.at(-1).content;
          const blockedInput = await services.moderate(config, history.map(m => m.content).join('\n'));
          let reply = 'I can help with respectful dating and communication. Let’s focus on mutual consent, clear boundaries, and safe connections between adults.';
          if (!blockedInput) {
            const response = await services.openai(config, 'chat/completions', {
              model: config.coachModel, store: false, max_completion_tokens: 350,
              messages: [{ role: 'system', content: coachInstructions(coach, body.mode, scenarios[body.scenario]) }, ...history],
            });
            const data = await response.json();
            reply = data.choices?.[0]?.message?.content?.trim();
            assert(reply && reply.length <= 4000, 502, 'Your coach couldn’t finish the response. Please try again.');
            if (await services.moderate(config, reply)) reply = 'Let’s take a safer approach. I can help you express interest clearly, respect boundaries, and respond thoughtfully.';
          }
          let speech = null;
          if (body.spoken === true) {
            try {
              const response = await services.openai(config, 'audio/speech', { model: config.speechModel, voice: { wingman: 'cedar', bestie: 'coral', straight: 'marin' }[coach], input: reply, response_format: 'mp3', instructions: 'Speak warmly and clearly, like a supportive communication coach.' });
              const buffer = Buffer.from(await response.arrayBuffer());
              if (buffer.length <= 1024 * 1024) speech = buffer.toString('base64');
            } catch { /* Coaching stays useful if speech is temporarily unavailable. */ }
          }
          result = json({ text, reply, speech, message_id: randomUUID(), used: quota.used, limit: quota.limit });
        } else if (path === 'billing/verify' && request.method === 'POST') {
          assert(profile.age_confirmed, 403, 'Please complete adult onboarding before subscribing.');
          const body = await bodyJson(request);
          await services.verifyPurchase(db, config, user.id, body.purchase_token);
          result = json({ entitlement: await services.entitlement(db, config, user.id, false) });
        } else if (path === 'sessions' && request.method === 'GET') {
          const { data, error } = await db.from('voice_sessions').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100);
          if (error) throw error; result = json({ sessions: data || [] });
        } else if (path === 'sessions' && request.method === 'POST') {
          const body = await bodyJson(request);
          const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const messages = validateMessages(body.messages, 100).map((message, index) => ({ ...message, id: typeof body.messages[index].id === 'string' && uuid.test(body.messages[index].id) ? body.messages[index].id : randomUUID() }));
          assert(messages.length > 1 && messages.at(-1).role === 'assistant', 400, 'Complete a coaching exchange before saving.');
          assert(COACH_IDS.includes(body.coach) && ['advice', 'practice'].includes(body.mode), 400, 'Invalid session.');
          const scenario = body.scenario || 'intro';
          assert(['intro', 'second', 'boundary', 'rejection'].includes(scenario), 400, 'Invalid practice scenario.');
          assert(typeof body.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id), 400, 'Invalid session ID.');
          const owner = await db.from('voice_sessions').select('user_id').eq('id', body.id).maybeSingle();
          if (owner.error) throw owner.error;
          assert(!owner.data || owner.data.user_id === user.id, 403, 'This session belongs to another account.');
          const record = { title: String(body.title || 'A conversation').slice(0, 80), mode: body.mode, coach: body.coach, scenario, messages };
          // Owner-scoped updates and non-upsert inserts prevent service-role ownership races.
          const write = owner.data
            ? db.from('voice_sessions').update(record).eq('id', body.id).eq('user_id', user.id)
            : db.from('voice_sessions').insert({ id: body.id, user_id: user.id, ...record });
          const { data, error } = await write.select().single();
          assert(error?.code !== '23505', 409, 'This session changed while saving. Please try again.');
          if (error) throw error; result = json({ session: data });
        } else if (path === 'sessions' && request.method === 'DELETE') {
          const body = await bodyJson(request);
          let query = db.from('voice_sessions').delete().eq('user_id', user.id);
          if (body.id) query = query.eq('id', body.id);
          const { error } = await query; if (error) throw error; result = json({ ok: true });
        } else if (path === 'reports' && request.method === 'POST') {
          const body = await bodyJson(request);
          assert(REPORT_REASONS.includes(body.reason), 400, 'Choose a report reason.');
          assert(typeof body.content === 'string' && body.content.length <= 4000, 400, 'Invalid response.');
          const { data: quota, error: quotaError } = await db.rpc('voice_reserve_report', { p_user: user.id });
          if (quotaError) throw quotaError; assert(quota, 429, 'You’ve submitted several reports today. Please try again tomorrow.');
          const { error } = await db.from('voice_reports').insert({ user_id: user.id, reason: body.reason, content: body.content, note: String(body.note || '').slice(0, 500), message_id: String(body.message_id || '').slice(0, 80) });
          if (error) throw error; result = json({ ok: true });
        } else if (path === 'account/export' && request.method === 'GET') {
          const sessions = await db.from('voice_sessions').select('*').eq('user_id', user.id);
          const reports = await db.from('voice_reports').select('reason,note,content,created_at').eq('user_id', user.id);
          if (sessions.error || reports.error) throw sessions.error || reports.error;
          result = json({ email: user.email, profile, sessions: sessions.data, reports: reports.data, exported_at: new Date().toISOString() });
        } else if (path === 'account' && request.method === 'DELETE') {
          const body = await bodyJson(request);
          assert(body.confirmation === 'DELETE' && typeof body.password === 'string', 400, 'Type DELETE and enter your password to confirm.');
          // Fresh password verification protects destructive actions even with an active session.
          const verifier = services.database(config);
          const login = await verifier.auth.signInWithPassword({ email: user.email, password: body.password });
          assert(!login.error && login.data.user?.id === user.id, 403, 'Your password wasn’t correct. Please try again.');
          const revoke = await db.auth.admin.signOut(token, 'global');
          if (revoke.error) throw revoke.error;
          const removed = await db.auth.admin.deleteUser(user.id);
          if (removed.error) throw removed.error;
          result = json({ ok: true });
        } else throw new HttpError(404, 'That page wasn’t found.');
      }
    } catch (error) {
      // Never log request bodies, audio, transcripts, passwords, access/purchase tokens.
      if (!error.status) console.error('Rizzmaster API failed', { code: error.code || 'INTERNAL' });
      result = json({ error: error.status ? error.message : 'Something went wrong. Please try again.' }, error.status || 500);
    }
    if (allowed && origin) {
      result.headers.set('Access-Control-Allow-Origin', origin);
      result.headers.set('Vary', 'Origin');
      result.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      result.headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    }
    result.headers.set('X-Content-Type-Options', 'nosniff');
    return result;
  };
}
export default createHandler();
