# Verification evidence

Story: an adult signs in, consents to voice processing, records or types a message, receives an AI coaching response, optionally saves it, and purchases verified Plus access through Google Play.

| Boundary | Evidence | Status |
| --- | --- | --- |
| UI and navigation | Browser screenshots and interactions in `design-qa.md` | Passed in sample preview |
| Local API adapter | `/api/health` returned `{ "ok": true, "configured": false }` | Running; environments intentionally missing |
| Auth/premium/consent gates | Handler fixture tests reject absent/revoked sessions, premium misuse and missing voice consent | Passed automated tests |
| Provider ordering and moderation | Quota reserved before paid work; input/output moderation checked and outages fail closed | Passed automated tests |
| Database schema | Actual `supabase/setup.sql` executed in PGlite, including RLS, privileges, quotas, session revocation and deletion cascade | Passed local SQL tests |
| Google subscription states | Active/grace/canceled paid-through access; pending/hold/paused/expired and unknown products denied | Passed unit tests |
| Ownership | Other-user session writes rejected; competing insert conflicts do not replace ownership | Passed automated tests |
| React/TypeScript build | `npm run build` | Passed |
| Production dependency audit | `npm audit --omit=dev`: zero vulnerabilities | Passed |
| Android package | Gradle `assembleDebug` with SDK 36/JDK 21; native Play Billing dependency 9.0.0 | Passed compilation |
| Release configuration | `npm run check:release` names missing values without printing secrets | Correctly blocked until environments are added |
| Live full story | Supabase, OpenAI, Google Play, SMTP, Vercel, physical device | Pending user configuration |

Automated result: **22 tests passed, zero failed**. Tests use no real accounts, audio, payments or provider secrets. No cloud project was deployed or altered.

The preview APK contains sample mode and is debug-signed. It is for testing the interface, not Play Store submission. The generated designs are reference boards, not evidence of live subscription or provider integration.
