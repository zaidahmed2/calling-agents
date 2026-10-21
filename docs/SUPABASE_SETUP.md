# Supabase Setup

## Local environment

The repository ignores `.env.local`. It already exists in this workspace; keep its current values private and edit it locally. The app needs:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
INTEGRATION_ENCRYPTION_KEY=BASE64_OR_HEX_32_BYTE_KEY
OTP_RATE_LIMIT_PER_MINUTE=5
```

The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` name is also accepted. The service role key is used only by authenticated server routes for account provisioning and protected company operations. Do not put it, the database password, JWT secret, integration encryption key, or provider secrets in a `NEXT_PUBLIC_` variable or browser code.

GHL, Crazytel, and external company database credentials are encrypted using `INTEGRATION_ENCRYPTION_KEY`. This is an app-server key, separate from both the central Supabase keys and each company's project keys. Generate a 32-byte key, encode it as Base64 or 64 hexadecimal characters, and store it only in the app's server environment. Restart or redeploy after changing it. Back it up securely: encrypted credentials cannot be recovered if the key is lost.

## Apply migrations

From the project root, install and authenticate the Supabase CLI, then link the intended development project and apply migrations:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The migrations create the application tables and then harden RLS policies. Review the SQL in `supabase/migrations` before applying it to a non-development project. No customer data or demo fixture rows are included.

Migration `20261018_000016_company_database_registry.sql` adds the central company database registry. Apply the central migration before deploying code that uses company database routing. Existing companies are registered in shared mode; newly created companies can select shared mode or external Supabase mode.

Migration `20261020_000018_super_admin_company_context.sql` enables selected-company administration for platform Super Admins. Apply it to the central project before deploying the **View as Admin** feature; tenant Supabase projects do not need this central migration.

Migration `20261020_000019_agent_session_event_history.sql` records agent sign-ins and each work-timer start, pause, resume, and end, and enables the company admin session audit page. Apply it to the central project. Historical session totals remain available, but individual sign-in and pause/resume events cannot be reconstructed for dates before this migration.

Migration `20261021_000020_agent_crazytel_trunks.sql` adds per-agent Crazytel SIP trunk assignments to central company memberships. Apply it centrally before configuring dedicated trunks from an agent's activity page.

## Company-specific Supabase projects

External company projects use the separate, minimal tenant schema in `supabase/tenant-migrations/20261018_000001_tenant_crm.sql`. Apply and review this migration in the company's own Supabase project (for example, using that project's SQL Editor) before entering its credentials in `/super-admin`. It creates the tenant CRM tables, indexes, foreign keys, lifecycle RPCs and RLS/grants; it does not apply the central platform migration history or change central data. For existing tenant projects that already applied the initial migration, apply `supabase/tenant-migrations/20261021_000002_answered_call_duration.sql` to update call-duration tracking and the tenant compatibility version.

Only Supabase-managed HTTPS project URLs (`https://<project-ref>.supabase.co`) are currently accepted. In `/super-admin`, open the company's database setup, enter the project ID (the server constructs its `https://<project-id>.supabase.co` URL), publishable key, and service-role key, then choose **Save / Configure**. The server encrypts the submitted credentials with `INTEGRATION_ENCRYPTION_KEY` and never returns them. After applying the tenant migration(s), choose **Verify Database**; this checks for tenant schema version `20261021_000002` and activates the company only after success. A failed verification leaves the company in setup and the saved credentials available for retry. The service-role key bypasses tenant RLS; it is only used server-side after the central auth/membership/role check, and every CRM query is additionally scoped to the resolved company and/or authorized agent.

The app does not provision projects or run SQL against an external project. The project owner must apply the tenant migration first. Keep tenant migrations append-only and versioned; after changing tenant schema, add a new migration and update the application compatibility check deliberately.

The current company database is selected from central `company_databases` metadata for each server CRM operation. Company authentication, memberships, invitations, integration configuration/credentials and work sessions remain central. Contacts, assignment history, calls, dispositions, callbacks, and company operational/audit events use the selected CRM database. `contacts_cache` and historical GHL-only rows are not transferred by this feature.

Migration `20261016_000015_multitenant_foundation.sql` adds a `Legacy Workspace`, backfills existing profiles and operational rows into it, preserves existing external GHL IDs/history, and adds company memberships, internal contacts, integrations, mappings, and company-aware authorization. New internal contacts start empty; import them from GHL only if that company configures GHL. This migration has not been applied by the app.

After migrations, designate the platform owner using an existing active admin profile:

```sql
update public.profiles
set platform_role = 'super_admin'
where normalized_email = lower('REPLACE_WITH_PLATFORM_OWNER_EMAIL')
  and app_role = 'admin'
  and is_active = true;
```

Confirm exactly the intended row was updated. Never expose public signup for this role or allow users to promote themselves. Sign in at `/`; the Super Admin is routed to `/super-admin`.

New migration files are append-only. If the work-session RPC currently errors when pausing/ending or does not auto-pause idle sessions, apply the follow-up migration `20261010_000005_fix_work_session_rpc.sql` with `npx supabase db push`. Do not edit or rerun an already-applied migration file; Supabase applies only pending migration versions.

If the timer RPC reports PostgreSQL error `42702` (`column reference "active_seconds" is ambiguous`), apply `20261010_000006_qualify_work_session_columns.sql` with `npx supabase db push`. This is a new migration that replaces the RPC with fully qualified table-column references; migrations `000004` and `000005` remain unchanged.

The agent call/outcome flow requires migrations `20261011_000007_manual_agent_call_workflow.sql`, `20261011_000009_manual_calls_hold_timer.sql`, `20261011_000010_secure_manual_call_rpcs.sql`, `20261011_000011_call_stage_outcomes.sql`, `20261011_000012_end_call_before_disposition.sql`, `20261011_000013_demo_calls_do_not_hold_work_timer.sql`, `20261013_000014_crazytel_sip_call_timer.sql`, and `20261021_000021_answered_call_duration.sql`. Admin assignment history requires `20261011_000008_contact_assignment_history.sql`. Apply all pending files with `npx supabase db push`. Assignment history begins at migration 000008 and cannot reconstruct earlier assignment changes made in GHL. SIP.js browser call duration starts at answer and is saved from the server end action; it remains agent-reported until provider CDR/webhook reconciliation is implemented.

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

After the multi-company migration, manually provisioned profiles also require a `company_memberships` row for their company. Existing profiles have already been backfilled to `legacy-workspace`. Prefer the authenticated platform/company admin provisioning flows, which create the Auth user, profile, and membership together without sending an invitation email. Users request an email OTP themselves from the login page. A GHL mapping is optional; internal contact workflows do not require it.

## Verify access

- An active platform Super Admin goes to `/super-admin`.
- An active company admin goes to `/dashboard` for their company.
- An active company agent goes to `/open-queue` for assigned internal contacts.
- Authenticated Supabase users without an active profile are signed out and denied application access.
- Tenant tables are constrained by company-aware RLS; agents see only their own company contacts assigned to their profile and marked Open.
- Admin dashboard numbers are database counts. Empty tables show zero or empty states; no demo rows are seeded.
- GHL synchronization is manual and disabled until enabled in company settings. Automatic bidirectional sync is not enabled.
- Crazytel calls require company-specific Hybrid SIP configuration; browser SIP credentials are necessarily delivered to the authenticated agent session.

## Current limitations

- Supabase project migrations and live email delivery cannot be run from this workspace without your project reference and authorization. Apply them to your development project, then verify the login flow.
- The first platform Super Admin must be designated through an owner-controlled SQL update. Company and agent account provisioning require valid server-side Supabase service credentials. Sign-in OTP delivery requires configured email delivery.
- The current OTP rate limiter is process-local. Use a shared store or edge/platform rate limiting before multi-instance production deployment.