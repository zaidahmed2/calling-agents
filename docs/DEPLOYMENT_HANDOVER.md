# Deployment and Handover Guide

## 1. Environment configuration

Use the repository-root `.env.example` as the source of truth for variable names. Populate a real `.env.local` or deployment secret store with the actual values, never commit real secrets.

Required names:
- `NEXT_PUBLIC_APP_URL`
- `APP_ENV`
- `NEXT_PUBLIC_SITE_NAME`
- `SESSION_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `GHL_PRIVATE_INTEGRATION_KEY`
- `GHL_WEBHOOK_SECRET`
- `GHL_LOCATION_ID`
- `GHL_CONTACT_STATUS_FIELD_KEY`
- `GHL_CONTACT_STATUS_VALUES`
- `GHL_OPEN_STATUS_VALUE`
- `CRAZYTEL_API_BASE_URL`
- `CRAZYTEL_API_KEY`
- `CRAZYTEL_API_SECRET`
- `CRAZYTEL_WEBHOOK_SECRET`
- `CRAZYTEL_OUTBOUND_SIP_URI`
- `CRAZYTEL_CALLER_ID`
- `CRAZYTEL_TEST_DESTINATION`
- `CRAZYTEL_RECORDING_ENABLED`
- `OTP_RATE_LIMIT_PER_MINUTE`
- `CALL_REVEAL_RATE_LIMIT_PER_MINUTE`
- `CALL_INIT_RATE_LIMIT_PER_MINUTE`
- `WEBHOOK_SECRET`

## 2. Supabase setup

1. Create or connect the Supabase project.
2. Apply the versioned migrations under `supabase/migrations`.
3. Enable Row Level Security on all sensitive tables.
4. Keep the service-role key server-only; do not expose it to the browser.
5. Verify the auth provider and app role mapping before production sign-in is enabled.

## 3. GHL production readiness checklist

Before enabling live reads or writes, verify:
- the actual auth method in use (OAuth or private integration)
- account-level role mapping and assigned user IDs
- the exact Open-state definition in the current CRM
- the subject field and contact metadata contract
- the endpoint used for contact updates and notes
- the valid webhook secret and event contract

Until those are confirmed, the app remains fail-closed and never claims live contact sync success.

## 4. Crazytel production readiness checklist

Before initiating live calls:
- confirm the exact account calling method (SIP, WebRTC, API, or other)
- verify the outbound caller ID and emergency/call restrictions
- confirm event/webhook payloads and signature verification method
- confirm recording enablement, URL visibility, retention, and access control
- validate a safe test destination before any live production call

## 5. Deployment steps

1. Copy `.env.example` to `.env.local` for local use or to the deployment secret manager for production.
2. Install dependencies with `npm install`.
3. Run `npm test`, `npm run lint`, and `npm run build`.
4. Apply Supabase migrations.
5. Configure production webhook URLs and register the callback endpoints.
6. Test the app against approved test users and test data only.
7. Keep all provider credentials in the deployment platform secret manager, not in source control.

## 6. Rollback plan

- Remove or disable the production env values.
- Disable provider webhooks if an outage or unexpected event traffic is detected.
- Revert to the safe demo/mock mode by keeping the fail-closed provider gates enabled.
- Restore the last-known-good deployment and audit logs if production writes unexpectedly occur.

## 7. Known limitations

- Live GHL contact reads/writes remain intentionally blocked until the actual provider contract is verified.
- Live Crazytel calling and recording access remain intentionally blocked until account-side evidence is provided.
- The app currently behaves as a secure, audited, staged local shell rather than a production-verified CRM/telephony integration.
- Real webhook replay and spoofing tests require a real provider account and secret configuration.

## 8. Handover notes

The current implementation is intentionally honest about what has and has not been verified. It is suitable for continuing development in a local or staging-safe environment, but it should not be treated as production-connected until the owner validates the account-side contracts above and approves the real provider setup.
