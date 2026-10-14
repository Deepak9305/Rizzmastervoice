# Rizzmaster Voice

An Android-first, voice-driven AI dating and communication coach in the original Rizzmaster aesthetic: Space Grotesk, near-black backgrounds, pink/violet accents, warm gold details and glass panels.

## Run now

Requires Node 22.12 or newer.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Without environment keys the app shows a clearly labeled preview with sample replies. You can explore onboarding, coaching, roleplay, recap, saved sample sessions, premium, settings, privacy and reporting. Preview authentication and payments are never simulated. Voice recordings in preview are discarded without contacting a provider.

## Included

- Responsive React/TypeScript frontend and Capacitor Android project, package `com.rizzmaster.voice`.
- Email/password Supabase authentication, email confirmation, password recovery, adult onboarding and explicit microphone consent.
- Record-and-reply voice coaching (up to 45 seconds), transcription, spoken AI replies, keyboard mode, mute and replay. This is turn-based voice coaching, not a continuous live call.
- Three coach styles, four fictional practice scenarios, optional transcript saving, search, recap, deletion and account export.
- Weekly and monthly Google Play subscriptions using localized store prices, restore, server verification, acknowledgement, purchase/account binding, authenticated purchase notifications and cancellation links.
- Free 5 turns/day; Plus 60/day. Atomic database quotas, server-enforced premium access, input/output moderation and response reporting.
- Public privacy, terms and account-deletion pages, password-confirmed account deletion, cascading app-data deletion and revoked-session rejection.
- Generated screen boards in `design/`, production assets in `public/`, Vercel API handlers in `server/`, and initial database setup in `supabase/setup.sql`.

## Add your environments later

Follow [docs/SETUP.md](docs/SETUP.md), copy `.env.example` to `.env.local`, and fill the values. Client `VITE_*` values are embedded when building; server secrets stay on Vercel. Rebuild/sync Android after changing client values. Never place OpenAI, Google service account or Supabase secret keys in a `VITE_*` variable.

## Validate and build

```powershell
npm test
npm run build
npm run android:sync
npm run android:open
```

The automated suite exercises subscription state handling, input validation, authenticated API boundaries, quota-before-provider ordering, moderation, session ownership and the real SQL schema using PGlite. SQL tests cover RLS, denied client writes, daily quotas, session revocation and deletion cascades.

`npm run check:release` intentionally fails while required launch environments are missing. Complete [docs/PLAY_STORE.md](docs/PLAY_STORE.md), configure the legal operator details, and test on a physical Android device with Play license testers before release. Google Play approval is determined by Google; this project implements the relevant controls but cannot guarantee acceptance.

APK and AAB build artifacts are excluded from this source repository. A production AAB requires your environments, Play products, service-account access, signing key and release testing.

## Screen map

See [docs/SCREENS.md](docs/SCREENS.md) and [design-qa.md](design-qa.md) for implemented routes, image references and verification evidence.
