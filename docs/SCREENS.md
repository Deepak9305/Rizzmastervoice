# Screen boards and implementation

Design images were generated before implementation using the original Rizzmaster project's dark/pink/violet/gold aesthetic. Image-generation text/layout details are visual references; live behavior and prices use real app data.

| Board | Screens and implemented routes |
| --- | --- |
| `design/01-onboarding-auth.png` | Welcome `/`, adult onboarding `/age`, sign in `/login`, signup `/signup`, password recovery `/forgot`, coach selection `/choose-coach` |
| `design/02-coaching-practice.png` | Home `/home`, microphone disclosure `/consent`, voice/text coaching `/conversation`, roleplay `/practice`, takeaway `/recap` |
| `design/03-premium-account.png` | Saved sessions `/sessions`, weekly/monthly paywall `/premium`, profile `/profile`, privacy controls `/account`, report `/report`, deletion `/delete-account` |
| `design/04-legal-help-states.png` | Privacy `/privacy`, terms `/terms`, support `/help`, offline coaching, empty sessions, subscription `/subscription` |

Additional implemented states: password update `/reset-password`, voice-consent settings `/voice-settings`, verification email confirmation, declined/missing authentication configuration, microphone denial, quota exhausted, provider error, search no results, transcript deletion confirmation, data export and account deletion confirmation.

Preview mode uses deterministic sample coaching and explicitly disabled payments. Native subscription states, email delivery and live AI voice require environments and real services. They are not represented as successfully tested in the preview.

Screenshots from browser verification are in `design/qa/`. Generated orb artwork is a real image in `public/voice-orb.png`, not a CSS recreation. Brand launcher icons were reused from the supplied original Rizzmaster project.
