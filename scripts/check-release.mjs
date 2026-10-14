import { readFileSync, existsSync } from 'node:fs';
if (process.loadEnvFile) { try { process.loadEnvFile('.env.local'); } catch { /* Vercel env */ } }
const missing = [];
const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_API_BASE_URL', 'VITE_PUBLIC_APP_URL', 'VITE_SUPPORT_EMAIL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'OPENAI_API_KEY', 'PUBLIC_APP_URL', 'SUPPORT_EMAIL', 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', 'GOOGLE_RTDN_AUDIENCE', 'GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL'];
for (const key of required) if (!process.env[key]?.trim()) missing.push(key);
for (const key of ['VITE_API_BASE_URL', 'VITE_PUBLIC_APP_URL', 'PUBLIC_APP_URL']) {
  const value = process.env[key];
  if (value && !/^https:\/\//.test(value)) missing.push(`${key} must use HTTPS`);
}
if (process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL !== process.env.SUPABASE_URL) missing.push('Client/server Supabase URLs must match');
if (process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_secret_')) missing.push('A Supabase secret key cannot be used in the client');
if (process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.includes('.')) {
  try { if (JSON.parse(Buffer.from(process.env.VITE_SUPABASE_PUBLISHABLE_KEY.split('.')[1], 'base64url').toString()).role === 'service_role') missing.push('A service-role key cannot be used in the client'); } catch { missing.push('Invalid client Supabase key'); }
}
for (const [client, server, fallback] of [['VITE_PLAY_PRODUCT_ID','PLAY_PRODUCT_ID','voice_plus'],['VITE_PLAY_WEEKLY_PLAN_ID','PLAY_WEEKLY_PLAN_ID','weekly'],['VITE_PLAY_MONTHLY_PLAN_ID','PLAY_MONTHLY_PLAN_ID','monthly']]) if ((process.env[client] || fallback) !== (process.env[server] || fallback)) missing.push(`${client} and ${server} must match`);
if (!existsSync('android/app/src/main/AndroidManifest.xml')) missing.push('Android project has not been generated');
if (missing.length) { console.error('Release configuration incomplete (no secret values printed):\n' + missing.map(item => `- ${item}`).join('\n')); process.exitCode = 1; }
else console.log('Environment and native configuration checks passed. Complete docs/PLAY_STORE.md and device testing before submission.');
