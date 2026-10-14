# Environment and deployment setup

## 1. Supabase

Create a Supabase project and execute `supabase/setup.sql` once in SQL Editor. It creates five app tables with RLS and three service-only RPCs. Do not import the original Rizzmaster database or change that app's project. Run the script against the new Voice app project.

Enable email/password authentication and email confirmation. Set a production SMTP provider. Set Site URL to your public Vercel URL; add that URL and `/reset-password` as allowed redirects, plus localhost redirects for development. Email confirmation and recovery complete on the public website. The Android app then uses normal email/password sign-in; deep-link auto-return is not required or implemented.

Use the publishable key in `VITE_SUPABASE_PUBLISHABLE_KEY`; use a Supabase secret key in server-only `SUPABASE_SECRET_KEY`. Both URL variables must point to the same project. Restrict database and dashboard access to the operator. The app does not grant authenticated clients any direct write access. Reports are available to the operator in the private `voice_reports` table; review them regularly and act on abuse.

## 2. Local environment

Copy `.env.example` to `.env.local`. Fill public variables:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project HTTPS URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public publishable key |
| `VITE_API_BASE_URL` | Vercel origin, e.g. `https://your-app.vercel.app`, without `/api` |
| `VITE_PUBLIC_APP_URL` | Same public website origin |
| `VITE_SUPPORT_EMAIL` | Monitored support/privacy email |
| `VITE_PLAY_PRODUCT_ID` | `voice_plus` by default |
| `VITE_PLAY_WEEKLY_PLAN_ID` | `weekly` by default |
| `VITE_PLAY_MONTHLY_PLAN_ID` | `monthly` by default |

Fill server-only variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Same project URL and private server key |
| `GEMINI_API_KEY` | Server-only Gemini API key used to mint constrained, short-lived Live API tokens |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` by default |
| `OPENAI_API_KEY` | Optional legacy key for the turn-based `/api/coach` fallback; not needed for the Live voice path |
| `OPENAI_COACH_MODEL` | Defaults to `gpt-4o-mini` |
| `OPENAI_TRANSCRIBE_MODEL` | Defaults to `gpt-4o-mini-transcribe` |
| `OPENAI_SPEECH_MODEL` | Defaults to `gpt-4o-mini-tts` |
| `PUBLIC_APP_URL`, `SUPPORT_EMAIL` | Same public origin and support email |
| `ALLOWED_ORIGINS` | `https://localhost,http://localhost` plus any explicit additional trusted origins, comma separated |
| `ANDROID_PACKAGE_NAME` | `com.rizzmaster.voice` |
| `PLAY_PRODUCT_ID`, `PLAY_WEEKLY_PLAN_ID`, `PLAY_MONTHLY_PLAN_ID` | Must match client IDs |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Private Google service-account JSON, stored as one environment value |
| `GOOGLE_RTDN_AUDIENCE` | Full HTTPS `/api/billing/notifications` push endpoint |
| `GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL` | Authenticated Pub/Sub push identity |

For a temporary private voice test, `GEMINI_API_KEY` alone enables Gemini-only test mode when both Supabase server variables are absent. This mode intentionally skips account authentication, quotas, saved sessions and premium checks; it is not suitable for a public deployment. Add `GEMINI_ONLY_MODE=false` when configuring Supabase for production behavior.

For local API testing leave `VITE_API_BASE_URL` blank: Vite proxies `/api` to the included Node server on port 3001. For Android, a complete public HTTPS base URL is required. Do not put the secret key or provider credentials into the Android assets.

## 3. Vercel

Import this directory as the Vercel project root. The included `vercel.json` builds Vite and runs `api/index.mjs` as a Node function. Add the public and server environment variables in the correct deployment environments. Set Node runtime to 22.x. The short token request is handled by the Node function; the browser then connects directly to Gemini Live, so Vercel does not hold the audio session open.

Redeploy after adding environment values. Check `/api/health` returns `configured: true`; this means required values exist, not that provider credentials have been validated. Visit `/privacy`, `/terms`, and `/delete-account` while signed out. Confirm all routes work on direct reload. Configure domain/HTTPS and avoid deployment protection on the public privacy/deletion URLs or public API.

## 4. Google Play

Create the app using package `com.rizzmaster.voice`. Create one subscription `voice_plus` with two auto-renewing base plans: `weekly` with a one-week period and `monthly` with a one-month period. Activate both and choose your prices, countries and taxes in Play Console. The app reads actual localized prices; no prices or discounts are invented. Both plans have the same features and no trial offer is selected by this code.

Enable Android Publisher API and give the backend service account the Play app access needed to view/verify purchases and acknowledge subscriptions. Configure Real-time Developer Notifications to a Pub/Sub topic. Add an authenticated HTTPS push subscription pointing to `/api/billing/notifications`, with the configured audience and push service-account email. Grant the required Pub/Sub publishing permission to Google Play's publisher identity. The handler verifies Google's OIDC identity before processing notices; it never trusts client-declared subscription state.

Purchase tokens are bound to SHA-256 of the signed-in Supabase user ID using Google's obfuscated account ID. Use the same Rizzmaster account when restoring. Deleting an account removes that binding and does not cancel the Google subscription; cancellation warnings and links are present before deletion. Test account switching and this deletion edge case before launch.

## 5. Android

```powershell
npm ci
npm run check:release
npm run android:sync
npm run android:open
```

Android Studio needs SDK 36, a compatible JDK 21, and Gradle dependencies. Choose your own release signing key and keep it out of this repository. Build a signed Android App Bundle, upload to internal testing, and install through Google Play for billing tests. A sideloaded debug APK is useful for UI preview but is not a substitute for Play billing validation.

If changing the package name, update Capacitor configuration, the generated Android namespace/applicationId/Java package, `.env` package value, billing management URL and Play Console identity together. Recheck everything after a rename.

## 6. Operational checks

- Set provider spend budgets and alerts; use Supabase auth rate limits and Vercel infrastructure protection as needed. Per-account coaching limits are enforced before paid provider calls, but they are not a complete defense against automated account creation.
- Review the private report queue and publish a support response policy.
- Review provider retention/regions and finalize legal copy in `src/components/LegalScreens.tsx` with your operator identity and contact information.
- Test email verification/reset, wrong passwords, expired/revoked sessions, network failures, microphone denial, backgrounding, native export, account deletion, purchases, restore, cancellation, grace, hold, refunds and expiration using real configured services.
- Never log audio, passwords, access tokens, purchase tokens or transcripts in provider/application debugging output.
