# Google Play launch checks

Policy controls are implemented in the app. Console declarations, business information, release signing and live provider/device testing must be completed by the operator before submission. Policy review was based on Google's official documentation on 10 October 2026; recheck it when publishing.

## Implemented controls

- Adults-only onboarding with explicit 18+ self-confirmation and terms acceptance. AI replies and spoken voices are clearly disclosed. Roleplay is labeled fictional.
- Microphone permission requested only after prominent disclosure and consent. Text is available as an alternative. Capture stops on navigation/backgrounding, with a 45-second maximum and no raw-audio persistence by the app.
- HTTPS transport; secrets only on the backend; Supabase RLS isolates account data; usage and purchase state cannot be changed with public keys.
- Input/output AI moderation, respectful adult communication instructions and an in-app Report response action sending to a private operator review queue.
- Google Play Billing for Android digital subscriptions; weekly/monthly selection, actual localized prices, recurring period, automatic renewal, cancellation and free-plan options.
- Server verifies purchase product, base plan, account binding, expiry and state before access. Pending/on-hold/paused/expired purchases do not unlock Plus. Restore and authenticated RTDN are included.
- In-app account deletion and public `/delete-account` website. Fresh password verification and cascading deletion of app data. Explicit warning that deletion does not cancel Google Play subscriptions.
- Public privacy/terms routes, optional transcript saving, session deletion and data export. Saving is off by default.

## Complete before submission

1. Replace draft legal/operator fields in `LegalScreens.tsx`; configure monitored support/privacy contact and publish accessible HTTPS URLs. Explain retention, provider processing and regional rights using your actual setup.
2. Fill Play Console's privacy URL and web deletion URL. The deletion URL must open directly without a Vercel protection gate; users can sign in and delete without reinstalling the app. Provide a working email deletion alternative when configured.
3. Complete Data safety from actual behavior and providers. Assess account info (email/user IDs/name), audio sent for processing, conversation/report text, usage counts and purchase information. Describe optional saved transcripts accurately. Do not claim no data collection merely because raw audio is not stored by this app. Evaluate Google's service-provider sharing exceptions using your actual agreements.
4. Complete content rating, target audience 18+, app category, ads declaration, applicable social/dating and child-safety declarations, developer identity and support information. This implementation has no user-to-user messaging or public profiles. Review the correct Console classification for your actual release.
5. Add app-access instructions/reviewer credentials where required; explain email confirmation and free/premium flows. Never send private provider keys to reviewers.
6. Activate the weekly and monthly subscription base plans, prices and countries. Configure API verification and authenticated purchase notifications. Test Play license tester approval, decline, pending, restore, cancellation, renewals, grace, hold, expiration, refunds/revocation and account switching.
7. Test microphone denial/revocation, silent/short recording, device rotation, keyboard, offline, application background/foreground, expired login, password reset, save/delete/export and deletion on physical Android devices.
8. Review reports regularly. The Report response button is only useful when an operator actually investigates submissions and improves unsafe behavior.
9. Build a signed AAB using your signing key, verify target SDK requirements at submission, and run Play's pre-launch report. This project targets API 36 and has native Google Play Billing via the purchase plugin; verify the merged release manifest and dependency versions before uploading.
10. Review listing claims and generated marketing images. Do not promise successful dates, romantic outcomes or clinical mental-health treatment. The supplied mockups are design references; use actual production screenshots for store listing evidence.

## Official references

- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [AI-generated content policy](https://support.google.com/googleplay/android-developer/answer/14094294)
- [Subscriptions policy](https://support.google.com/googleplay/android-developer/answer/140504)
- [User data policy](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Google Play Billing security](https://developer.android.com/google/play/billing/security)
- [Subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions)

These controls support compliance; Google's review determines approval. The app is not release-ready until the operator-dependent items and live tests above are complete.
