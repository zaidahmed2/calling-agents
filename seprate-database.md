# Project Plan: Company-Specific Supabase Databases with Safe Rollback

## 1. Project context

The current application is a Next.js 16 App Router CRM using React, TypeScript, Supabase Auth, Supabase PostgreSQL, and Next.js API routes. It includes company memberships, agent assignments, internal contacts, browser calling through SIP.js/Crazytel, call dispositions, callbacks, work sessions, and GoHighLevel integration.

The current repository contains versioned migrations, but the live database's applied migration history and actual schema have not yet been verified.

This is an extension of the existing application, not a rebuild.

## 2. What I need

I need the application to support company-specific CRM databases while keeping the existing central Supabase project responsible for platform authentication and management.

The Super Admin must be able to create a company and select one of two database modes:

- **Existing database:** use the current shared CRM database, with strict company-level isolation.
- **External Supabase database:** connect the company's own Supabase project and store that company's CRM records there.

All company users should continue signing in through the existing central Supabase Auth email OTP flow.

The application must route each authorized request to the correct company database without requiring the frontend to know database credentials or connection details.

Existing CRM functionality must continue working.

## 3. Data ownership

### Central platform database

Keep the following centralized:

- profiles and central Supabase Auth identities
- companies and company memberships
- company invitations
- Super Admin privileges and platform-level permissions
- company database registry and connection status
- encrypted external database credentials and provisioning metadata
- platform-level settings and audit records
- work_sessions, unless a verified dependency requires a different arrangement

Keep company integration configuration and encrypted provider credentials centralized where needed for platform-level administration. Do not move these automatically.

### Company CRM database

Move or create company-scoped copies of the required CRM records:

- contacts and contact custom fields
- contact assignments and assignment history
- calls and call history
- call dispositions, outcomes, and notes
- callbacks and callback status
- company-level contact and call activity
- any additional contact-dependent records confirmed by the dependency audit

Inspect contacts_cache and legacy GHL identifiers before deciding whether they remain necessary.

Do not blindly move entire audit_logs or activity_logs tables. Separate company operational events from platform-level events.

Keep IDs and relationships consistent across contacts, calls, dispositions, callbacks, and assignment history.

## 4. Mandatory rollback boundary before implementation

Do not start implementation until the following checkpoint has been completed and verified.

Checkpoint name: pre-company-db-routing

### Code checkpoint

1. Inspect the current Git status and confirm there are no uncommitted user changes.
2. Record the current branch and commit SHA.
3. Create a dedicated feature branch for this project.
4. Create an annotated Git tag named pre-company-db-routing on the exact starting commit.
5. Push the branch and tag to GitHub if the repository remote is available and authorized.
6. Save a checkpoint report containing the commit SHA, branch, tag, migration inventory, and baseline test results.
7. Never overwrite or delete existing user work to make the working tree clean. If uncommitted work exists, report it and stop until it is safely preserved.

### Database checkpoint

1. Identify the intended central Supabase project without exposing secrets.
2. Verify the live schema, migration history, RLS policies, database functions, indexes, triggers, and relevant grants.
3. Determine which repository migrations have actually been applied.
4. Generate a schema snapshot and an inventory of important tables and functions.
5. Create a database backup or logical export appropriate to the project's plan and database size.
6. Store the backup outside the repository in an approved secure location.
7. Verify that the backup is readable and document the restoration procedure. Prefer testing restoration into a separate recovery project before relying on the backup.
8. Record any storage, Auth, or configuration resources that require separate recovery steps.

Do not assume a database backup includes every external setting, Auth configuration, secret, or storage object needed to reconstruct the entire application.

### Baseline verification

Run the available lint, type-check, test, and production-build scripts. Record the actual results, including pre-existing failures.

Document the current working login, contact, assignment, call, callback, and GHL workflows.

### Checkpoint acceptance condition

The checkpoint is complete only when:

- the original code commit is recoverable
- the database backup or export has been verified
- the live schema and migration history have been inspected
- the restoration procedure is documented
- the baseline test report exists

If any of these conditions cannot be verified, do not run production migrations or modify production data.

## 5. Architecture

Use the following request flow:

1. A user signs in through central Supabase Auth.
2. The server validates the session and retrieves the user's active company membership and role.
3. The server resolves that company's configured database mode.
4. A server-only database layer selects the shared database or the company's external database.
5. The operation executes with explicit company and user authorization.
6. The response contains only data the user is authorized to access.

Create a company database registry containing at least:

- company_id
- database_mode
- project reference and required connection metadata
- encrypted provisioning or connection credentials, where applicable
- connection status
- tenant schema version
- last successful connection check
- last successful migration and migration status
- provisioning error category without secret values
- created_at and updated_at

Use a schema that supports future changes without requiring an architectural rewrite.

Never accept a client-supplied database URL, SQL statement, or company ID as sufficient authorization to perform an operation.

## 6. External database connection and provisioning

The project URL and publishable key may be used for limited API connectivity checks, but they do not by themselves grant PostgreSQL migration privileges.

Support an explicitly authorized provisioning mechanism, such as a PostgreSQL connection with appropriately scoped permissions or a supported Supabase Management API/OAuth workflow.

Before enabling this feature:

1. Confirm the selected method's current Supabase permissions and limitations.
2. Minimize privileges and avoid collecting broad personal access tokens unnecessarily.
3. Keep provisioning credentials server-side and encrypt stored secrets.
4. Verify TLS and connection behavior.
5. Never return database passwords, service-role keys, access tokens, or encryption keys to the browser or logs.
6. Test connectivity and schema compatibility before marking a company ready.

Use a controlled provisioning worker or administrative workflow for migrations. Do not expose an endpoint that accepts arbitrary SQL from the browser.

## 7. Migration design

Create a dedicated tenant schema migration set rather than blindly applying the complete existing platform migration history to customer projects.

The tenant migration set must create and maintain only the required CRM tables, constraints, indexes, triggers, RPC functions, grants, and RLS policies.

Inspect all existing functions for dependencies on central profiles, company memberships, companies, and other platform tables. Replace those dependencies with explicit server authorization, appropriate tenant-local mappings, or carefully designed function inputs.

Do not assume a central Supabase Auth JWT is automatically trusted by an external Supabase project.

Track the tenant schema version and migration history. Verify the expected schema after applying migrations.

Do not automatically drop tables, remove columns, delete records, or run destructive transformations.

## 8. Application refactoring

Build a shared, server-only database routing layer and use it consistently.

Audit and update at least these existing flows:

- GET/POST/PATCH /api/admin/contacts
- PATCH /api/admin/contacts/[id]
- /api/admin/agents where agent/contact data is involved
- /api/contacts/[id]/reveal
- /api/calls/manual
- /api/callbacks/[id]
- GHL import/export paths that access CRM contacts
- contact detail, open queue, call history, and callback pages
- database RPCs used for assignments, call lifecycle, dispositions, and callbacks

Preserve existing API contracts where practical so that the frontend does not needlessly change.

Keep central login, platform company management, and work-session behavior functional.

Review how the current calling provider configuration is loaded. Do not accidentally move or expose provider secrets as part of the database routing change.

## 9. Existing data migration

If a company already has CRM data in the shared database, support a separate controlled transfer process.

Requirements:

- transfer only the selected company's records
- preserve primary keys and relevant relationships
- preserve contact-to-call and call-to-callback references
- preserve assignment history and relevant activity
- use resumable batches and idempotent writes
- detect duplicates and invalid references
- compare source and destination row counts
- verify representative records and foreign-key relationships
- record transfer status and reconciliation results
- do not delete the source data automatically

Keep the old database as the recovery source until the new database has passed acceptance tests and the cutover has been approved.

## 10. Rollback policy

Every implementation phase must document a rollback procedure before changes are applied.

### Code rollback

Use the feature branch and checkpoint tag to recover the original code. Use Git revert for already-shared changes where appropriate; do not rewrite shared history without authorization.

### Schema rollback

Prefer forward corrective migrations when schema changes may have affected data. Do not assume that deleting a migration file reverses a migration already applied to a live database.

For destructive or complex changes, use a verified backup and a documented restore procedure. Test restoration into a separate project whenever possible.

### Data rollback

Never assume schema rollback restores deleted or transformed records. Before data-transfer or data-modification operations, preserve the source and document the exact recovery method.

### Deployment rollback

Maintain a way to direct the application back to the previous database configuration until the new path is accepted.

Do not immediately delete old tables, credentials, or source records after cutover.

### Explicit approval

Do not restore over a production database, delete production data, apply destructive migrations, or switch production traffic without explicit authorization.

## 11. Implementation phases and gates

### Phase 1 — Read-only dependency audit

Produce the table/function/API dependency map, live schema status, current migration history, and a list of unresolved risks.

No code or database changes.

Gate: the user can review the report and confirm the checkpoint.

### Phase 2 — Checkpoint and recovery preparation

Create the Git checkpoint, verify the database backup/export, document restoration steps, and record baseline test results.

No production schema changes.

Gate: checkpoint acceptance conditions must all pass.

### Phase 3 — Tenant schema and migration testing

Create the tenant migration set and test it on local or disposable Supabase projects.

Verify schema, functions, RLS, grants, indexes, and constraints.

Gate: migrations must be reproducible and the tenant schema must pass automated checks.

### Phase 4 — Database registry and connection layer

Implement the central registry, encrypted credential handling, connectivity checks, and server-only routing.

Test both shared and external database modes without switching production traffic.

Gate: authorization and tenant-isolation tests must pass.

### Phase 5 — CRM workflow refactoring

Update contacts, assignments, calls, dispositions, callbacks, phone reveal, and relevant GHL sync flows to use the routing layer.

Gate: regression tests confirm existing functionality is preserved.

### Phase 6 — Company setup wizard

Implement the two database modes, connection testing, migration preview, explicit migration approval, schema verification, status reporting, and safe failure handling.

Gate: failed setup must never mark a company ready or route live requests to an incomplete database.

### Phase 7 — Data transfer and staging cutover

Transfer a test company's data, reconcile it, run end-to-end workflows, and test rollback.

Gate: do not switch a real company until the tests and recovery path are accepted.

### Phase 8 — Controlled production rollout

Enable the new mode for one approved company first. Monitor errors and data consistency. Expand gradually only after successful verification.

Keep the original source data and recovery plan available during the agreed rollback window.

## 12. Acceptance tests

Verify at minimum:

- central email OTP login still works
- Super Admin can manage companies
- shared-database mode continues to work
- Company A writes to its configured database
- Company B writes to its own configured database
- one company cannot read or modify another company's contacts
- agents see only authorized assigned contacts
- phone reveal permissions and audit events work
- call start, answer, end, outcome, notes, and callbacks work
- contact and call references remain consistent
- GHL contact import/export remains compatible
- external database connection failure is handled safely
- invalid credentials never appear in responses or logs
- migrations can be tested repeatedly without unintended data loss
- transfer reconciliation detects missing or duplicated records
- the previous code checkpoint can be restored
- the database recovery procedure has been tested or its unverified limitations are explicitly documented

## 13. Reporting requirements

After each phase, provide:

- files changed
- migrations created
- functions, tables, and routes affected
- tests executed and their actual results
- database environments changed
- backup and rollback status
- unresolved risks
- any manual setup or approval required

Never claim a migration, backup restoration, or production test succeeded unless it was actually executed and verified.

The implementation must stop at each phase gate if the required checks fail. Do not silently skip failed tests, bypass authorization, or proceed with production changes to meet a deadline.