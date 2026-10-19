# Calling CRM

Multi-company calling CRM built with Next.js, Supabase Auth, and PostgreSQL. Each company manages its own agents, contacts, assignments, calling settings, and optional GoHighLevel integration.

## Local Setup

1. Install dependencies with `npm install`.
2. Configure `.env.local` with `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `INTEGRATION_ENCRYPTION_KEY`.
3. Apply the reviewed Supabase migrations to the intended project.
4. Provision the first platform Super Admin using the steps in [Supabase setup](docs/SUPABASE_SETUP.md).
5. Start the app with `npm run dev`.

Generate a 32-byte integration encryption key, for example, with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep this key in the server secret manager and back it up securely; losing it makes stored provider credentials unrecoverable.

## Roles and Workflows

- Platform Super Admins create, activate, and deactivate companies from `/super-admin`.
- Each company can use the existing shared database or a separate Supabase project. External projects stay inactive until their owner applies the dedicated tenant migration and a Super Admin verifies the schema and connection.
- Company admins invite agents, manage internal contacts and assignments, import CSV/Excel files, and configure optional providers in `/settings`.
- Company admins can configure each agent's visible CRM contact fields from that agent's profile; the setting is stored in company membership and enforced on agent contact screens and phone/call actions.
- Company admins can export all company contacts, call history (including disposition notes/outcomes), callbacks, agent activity, and work sessions as Excel-compatible CSV files.
- Agents work only their assigned, open company contacts from `/open-queue`.
- New company contact and call workflows do not require GHL. GHL import/export is manual and disabled until enabled in company settings.
- Crazytel calling requires company-specific provider configuration. SIP/WebRTC credentials must be delivered to the authenticated browser to place calls; prefer individual provider credentials per agent.

See [database setup and account provisioning](docs/SUPABASE_SETUP.md) and [Crazytel WebRTC setup](docs/CRAZYTEL_WEBRTC_SETUP.md) for operational details.
Agent field access requires applying `supabase/migrations/20261019_000017_agent_contact_field_access.sql` to the central Supabase database.

## Checks

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Do not apply migrations to production or deploy without reviewing the SQL and environment configuration for the target project.