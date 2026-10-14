import { createClient } from '@supabase/supabase-js';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { HttpError, accountHash, subscriptionAccess } from './policy.mjs';
export function configuration(env = process.env) {
  return {
    supabaseUrl: env.SUPABASE_URL, supabaseKey: env.SUPABASE_SECRET_KEY,
    openaiKey: env.OPENAI_API_KEY,
    coachModel: env.OPENAI_COACH_MODEL || 'gpt-4o-mini',
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
    speechModel: env.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts',
    publicUrl: env.PUBLIC_APP_URL, supportEmail: env.SUPPORT_EMAIL,
    origins: (env.ALLOWED_ORIGINS || 'https://localhost,http://localhost').split(',').map(s => s.trim()).filter(Boolean),
    packageName: env.ANDROID_PACKAGE_NAME || 'com.rizzmaster.voice',
    productId: env.PLAY_PRODUCT_ID || 'voice_plus', weeklyId: env.PLAY_WEEKLY_PLAN_ID || 'weekly', monthlyId: env.PLAY_MONTHLY_PLAN_ID || 'monthly',
    playCredentials: env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
    rtdnAudience: env.GOOGLE_RTDN_AUDIENCE, rtdnEmail: env.GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL,
  };
}
export function database(config) {
  if (!config.supabaseUrl || !config.supabaseKey) throw new HttpError(503, 'Account services are being set up. Please try again later.');
  return createClient(config.supabaseUrl, config.supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } });
}
export async function openai(config, path, body, form = false) {
  if (!config.openaiKey) throw new HttpError(503, 'Your coach is being set up. Please try again later.');
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${config.openaiKey}`, ...(form ? {} : { 'Content-Type': 'application/json' }) },
    body: form ? body : JSON.stringify(body), signal: AbortSignal.timeout(40000),
  });
  if (!response.ok) throw new HttpError(response.status === 429 ? 503 : 502, 'Your coach couldn’t respond just now. Please try again.');
  return response;
}
export async function moderate(config, text) {
  const response = await openai(config, 'moderations', { model: 'omni-moderation-latest', input: text });
  const result = await response.json();
  if (!result.results?.[0] || typeof result.results[0].flagged !== 'boolean') throw new HttpError(502, 'We couldn’t safely process this request. Please try again.');
  return result.results[0].flagged;
}
async function playClient(config) {
  if (!config.playCredentials) throw new HttpError(503, 'Google Play verification is being set up.');
  let credentials;
  try { credentials = JSON.parse(config.playCredentials); } catch { throw new HttpError(503, 'Google Play verification is unavailable.'); }
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
  return auth.getClient();
}
export async function readPurchase(config, token) {
  const client = await playClient(config);
  try {
    const response = await client.request({ url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(config.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}` });
    return response.data;
  } catch (error) {
    if ([400, 404, 410].includes(error.response?.status)) throw new HttpError(400, 'This purchase is no longer valid. Restore from the Google account used to subscribe.');
    throw new HttpError(503, 'We couldn’t contact Google Play. Please try again.');
  }
}
export async function verifyPurchase(db, config, userId, token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) throw new HttpError(400, 'A valid Google Play purchase is required.');
  const purchase = await readPurchase(config, token);
  if (purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId !== accountHash(userId)) throw new HttpError(403, 'This purchase belongs to a different Rizzmaster account. Sign in to the account used to subscribe.');
  const { data: existing, error: lookupError } = await db.from('voice_purchases').select('user_id').eq('purchase_token', token).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing && existing.user_id !== userId) throw new HttpError(403, 'This purchase is already linked to another account.');
  const access = subscriptionAccess(purchase, config);
  if (!access.plan) throw new HttpError(400, 'This is not a supported Rizzmaster Voice subscription.');
  // Persist binding BEFORE acknowledgement; retries are idempotent and RTDN can recover.
  const { error } = await db.from('voice_purchases').upsert({ purchase_token: token, user_id: userId, ...access, updated_at: new Date().toISOString() }, { onConflict: 'purchase_token' });
  if (error) throw error;
  if (access.active && purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    const client = await playClient(config);
    try {
      await client.request({ url: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(config.packageName)}/purchases/subscriptions/${encodeURIComponent(config.productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, method: 'POST', data: {} });
    } catch { throw new HttpError(503, 'Your purchase is recorded, but Google Play confirmation needs a retry. Use Restore purchases.'); }
  }
  return access;
}
export async function entitlement(db, config, userId, refresh = true) {
  const { data: rows, error } = await db.from('voice_purchases').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(6);
  if (error) throw error;
  if (refresh && rows?.length) {
    for (const row of rows) {
      if (Date.now() - Date.parse(row.updated_at) > 60000) {
        try { Object.assign(row, await verifyPurchase(db, config, userId, row.purchase_token)); }
        catch (error) { if (error.status === 400) { row.active = false; const { error: updateError } = await db.from('voice_purchases').update({ active: false }).eq('purchase_token', row.purchase_token); if (updateError) throw updateError; } else throw error; }
      }
    }
  }
  const active = rows?.find(row => row.active && Date.parse(row.expires_at) > Date.now());
  const { data: usage, error: usageError } = await db.from('voice_usage').select('turns').eq('user_id', userId).eq('day', new Date().toISOString().slice(0, 10)).maybeSingle();
  if (usageError) throw usageError;
  return { active: Boolean(active), plan: active?.plan || null, expires_at: active?.expires_at || null, state: active?.state || rows?.[0]?.state || 'FREE', used: usage?.turns || 0, limit: active ? 60 : 5 };
}
export async function verifyPush(config, token) {
  if (!config.rtdnAudience || !config.rtdnEmail) throw new HttpError(503, 'Purchase notifications are not configured.');
  try {
    const ticket = await new OAuth2Client().verifyIdToken({ idToken: token, audience: config.rtdnAudience });
    const payload = ticket.getPayload();
    if (payload?.email !== config.rtdnEmail || !payload.email_verified) throw new Error('Invalid push identity');
  } catch { throw new HttpError(401, 'Invalid notification identity.'); }
}
