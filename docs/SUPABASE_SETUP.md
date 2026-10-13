# Supabase Setup

## Local environment

The repository ignores `.env.local`. It already exists in this workspace; keep its current values private and edit it locally. The app needs:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
OTP_RATE_LIMIT_PER_MINUTE=5
```

The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` name is also accepted. The manual agent-call workflow additionally needs `SUPABASE_SERVICE_ROLE_KEY` configured server-side. It is used only after the authenticated server route validates the agent and current GHL assignment. Do not put it, the database password, JWT secret, or provider secrets in a `NEXT_PUBLIC_` variable or browser code.

GHL/Crazytel settings are read server-side from the variable names in `.env.example`. Leave them unset until their account configuration and API contracts have been verified. The app intentionally reports provider operations as blocked without verified credentials/configuration; adding a key alone does not verify the integration.

## Apply migrations

From the project root, install and authenticate the Supabase CLI, then link the intended development project and apply migrations:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migrations create the application tables and then harden RLS policies. Review the SQL in `supabase/migrations` before applying it to a non-development project. No customer data or demo fixture rows are included.

New migration files are append-only. If the work-session RPC currently errors when pausing/ending or does not auto-pause idle sessions, apply the follow-up migration `20261010_000005_fix_work_session_rpc.sql` with `npx supabase db push`. Do not edit or rerun an already-applied migration file; Supabase applies only pending migration versions.

If the timer RPC reports PostgreSQL error `42702` (`column reference "active_seconds" is ambiguous`), apply `20261010_000006_qualify_work_session_columns.sql` with `npx supabase db push`. This is a new migration that replaces the RPC with fully qualified table-column references; migrations `000004` and `000005` remain unchanged.

The agent call/outcome flow requires migrations `20261011_000007_manual_agent_call_workflow.sql`, `20261011_000009_manual_calls_hold_timer.sql`, `20261011_000010_secure_manual_call_rpcs.sql`, `20261011_000011_call_stage_outcomes.sql`, `20261011_000012_end_call_before_disposition.sql`, `20261011_000013_demo_calls_do_not_hold_work_timer.sql`, and `20261013_000014_crazytel_sip_call_timer.sql`. Admin assignment history requires `20261011_000008_contact_assignment_history.sql`. Apply all pending files with `npx supabase db push`. Assignment history begins at migration 000008 and cannot reconstruct earlier assignment changes made in GHL. SIP.js browser call duration is recorded from the browser/server end action; it remains agent-reported until provider CDR/webhook reconciliation is implemented.

To sync call stage, notes, and callback time to GHL contact custom fields, follow [GHL call fields setup](GHL_CALL_FIELDS.md). Supabase remains the full append-only call history; the GHL fields show the latest result for that contact.

Crazytel Hybrid browser calling setup and account-side prerequisites are in [Crazytel WebRTC setup](CRAZYTEL_WEBRTC_SETUP.md). The Crazytel API key is separate from SIP/WebRTC credentials and is never used as browser media authentication.

## Enable email OTP

In Supabase Dashboard, enable Email auth and configure the email template to include the numeric token (`{{ .Token }}`). Configure the allowed redirect/site URL for `http://localhost:3000` during local testing and the final HTTPS origin after deployment. The login request does not expose whether an address exists. Sign-up is disabled in the application; provision auth users from the Supabase dashboard or an approved administrative process.

## Provision agent and admin accounts

1. Create or invite the user in Supabase Authentication using the real work email.
2. Copy the Auth user UUID from the dashboard.
3. Run this SQL in the Supabase SQL editor after replacing every `REPLACE_...` value with the intended user's real values. Never grant `admin` based only on an email submitted by the user.

```sql
insert into public.profiles (id, normalized_email, ghl_user_id, app_role, is_active)
values (
  'REPLACE_WITH_AUTH_USER_UUID'::uuid,
  'REPLACE_WITH_REAL_WORK_EMAIL',
  null,
  'admin',
  true
)
on conflict (id) do update
set normalized_email = excluded.normalized_email,
    app_role = excluded.app_role,
    is_active = excluded.is_active;
```

Use `agent` instead of `admin` for an agent account. Once the actual GHL user identity has been verified, set `ghl_user_id` to that account's real GHL user ID. Until then agent queue reads remain blocked. Start by provisioning one owner-controlled admin, verify login and role routing, then add test agents.

## Verify access

- An active profile with role `admin` goes to `/dashboard`.
- An active profile with role `agent` goes to `/open-queue`.
- Authenticated Supabase users without an active profile are signed out and denied application access.
- Agent queries are constrained by RLS to their own records and contacts assigned to their mapped GHL user ID with Open status.
- Admin dashboard numbers are database counts. Empty tables show zero or empty states; no demo rows are seeded.
- GHL/Crazytel call actions stay blocked until their actual account requirements and contracts are verified.

## Current limitations

- Supabase project migrations and live email delivery cannot be run from this workspace without your project reference and authorization. Apply them to your development project, then verify the login flow.
- Initial role provisioning is deliberately an owner-controlled SQL/dashboard task; there is no public signup, self-serve role assignment, or unprotected admin creation route.
- The current OTP rate limiter is process-local. Use a shared store or edge/platform rate limiting before multi-instance production deployment.