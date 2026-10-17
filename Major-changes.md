# Implementation Plan: Transform Existing CRM into a Multi-Company Calling SaaS

## 1. Project Overview

We currently have a working calling-agent CRM built with:

- **Frontend:** Next.js
- **Backend:** Next.js API Routes
- **Database:** Supabase PostgreSQL
- **Authentication:** Supabase Auth with email OTP
- **Current Integration:** GoHighLevel (GHL)

The application currently has an Admin Dashboard and a Calling Agent Dashboard. Contacts are retrieved from GHL, managed by the administrator, assigned to agents, and displayed on their dashboards.

We now need to transform this application into a **multi-company SaaS CRM** where each company manages its own administrators, agents, contacts, assignments, integrations, and calling configuration.

The internal CRM must work independently of GHL. GHL and calling-provider integrations will become optional features that each company can configure separately.

**Important:** Do not rebuild the entire project from scratch. Inspect the existing codebase and reuse existing components, business logic, and dashboards wherever possible.

## 2. New System Roles

### A. Super Admin — Platform Owner

The Super Admin is the platform owner and will have a dedicated Super Admin Dashboard.

Required functionality:

- Create new companies.
- View and manage all companies.
- Edit company details.
- Activate or deactivate companies.
- Add or designate the initial company administrator.
- Manage company-level access.

When the Super Admin creates a company, the system must associate an administrator email with that company.

The Super Admin Dashboard must be separate from the existing Admin Dashboard.

### B. Company Admin

Each company will have its own administrator.

When the company administrator logs in using the registered email and completes OTP verification, the existing Admin Dashboard should open, adapted for that company's data.

The company administrator must be able to:

- Add, manage, activate, and deactivate agents.
- Create contacts manually.
- Import contacts from CSV or Excel files.
- View and manage company contacts.
- Assign contacts to agents.
- Reassign contacts.
- Manage contact statuses and supported fields.
- Configure optional GHL integration.
- Configure calling-provider settings.
- Manage field mappings and synchronization preferences.

A company administrator must never access another company's contacts, agents, or integration settings.

### C. Calling Agent

The company administrator can add agents by email.

When an agent logs in through Supabase Auth OTP, the system must verify their company membership and role before displaying the existing Agent Dashboard.

Agents must be able to:

- View their assigned contacts.
- Perform the existing supported calling workflow.
- Access relevant contact information and callback functionality.
- See only contacts and information they are authorized to access.

Agents must not be able to access another company's data.

## 3. Remove GHL as a Mandatory Dependency

This is a major architectural change.

Currently, the CRM retrieves contacts from GHL. This behavior must change.

The internal CRM will become the primary source of contact data.

The following features must work without GHL:

- Contact creation.
- Contact editing.
- Contact listing.
- Contact assignment.
- Agent contact visibility.
- Contact status management.
- CSV and Excel imports.
- Existing relevant contact workflows.

Inspect the codebase and identify every GHL dependency, including:

- Contact fetching.
- Contact creation and updates.
- Assignment synchronization.
- GHL-dependent dashboard loading.
- API routes.
- Webhooks.
- Background jobs.
- Environment variables.
- Authentication checks.
- Frontend components.

Remove or refactor mandatory dependencies without deleting reusable GHL integration functionality.

If a company has not connected GHL, its dashboard must continue working normally without integration errors.

Do not delete existing contact data or perform destructive migrations.

## 4. Internal Contact Management

All contacts must be managed inside the CRM by default.

### Manual contact creation

The company administrator must be able to create contacts directly from the Admin Dashboard.

Preserve the existing relevant fields, such as contact name, phone number, email, status, assigned agent, subject, notes, and other fields already used by the application.

Do not unnecessarily redesign the existing contact model.

### CSV and Excel imports

Implement a reliable spreadsheet import workflow:

1. Upload a supported file.
2. Preview the records.
3. Map spreadsheet columns to internal CRM fields.
4. Validate required fields and data formats.
5. Identify potential duplicates.
6. Display validation errors.
7. Import valid records.
8. Show an import summary.

The import must work without GHL.

### Contact assignment

The company administrator must be able to assign or reassign contacts to agents belonging to the same company.

Assignments must be reflected in the Agent Dashboard.

When a contact is reassigned, the previous agent must lose access unless another explicitly authorized permission allows it.

Assignments must not require GHL synchronization.

## 5. Optional GHL Integration

GHL must become an optional integration that each company can configure from its own settings.

Create a dedicated **Integrations / GoHighLevel Settings** section in the company Admin Dashboard.

It should support:

- Enabling or disabling GHL integration.
- Securely configuring the supported GHL authentication method.
- Selecting the relevant account or location where applicable.
- Testing the connection.
- Viewing connection status.
- Retrieving standard and custom contact fields.
- Configuring field mappings.
- Configuring contact imports and exports.
- Viewing synchronization errors.
- Disconnecting GHL safely.

Do not assume every company will use GHL.

Do not make GHL credentials mandatory for authentication, contact management, or agent dashboards.

Keep GHL-specific logic inside a dedicated integration service or adapter. The internal CRM must not depend directly on GHL response formats.

Never expose API keys, access tokens, or refresh tokens in frontend code or client-visible API responses.

## 6. GHL Custom Fields and Field Mapping

This is a critical requirement.

Different GHL accounts may contain different custom fields. The application must retrieve the actual fields from the connected account instead of hardcoding field names.

### Retrieve GHL fields

After connecting GHL, provide a **Refresh GHL Fields** action.

The backend must:

1. Validate the company's GHL connection.
2. Retrieve available standard and custom contact fields using the supported GHL API.
3. Normalize the field metadata.
4. Store or cache the metadata where appropriate.
5. Display the fields in the mapping interface.

Use stable field identifiers wherever available rather than relying exclusively on display labels.

### Field mapping interface

Allow the company administrator to map internal CRM fields to GHL fields.

For example:

| Internal CRM Field | GHL Field |
|---|---|
| Contact Name | Contact Name |
| Phone Number | Phone |
| Email Address | Email |
| Lead Subject | GHL Custom Field |
| Lead Source | GHL Custom Field |
| Callback Time | GHL Custom Field |

These are examples only. The actual options must come from the connected account and the supported internal fields.

The mapping interface must support:

- Selecting internal fields.
- Selecting GHL fields.
- Saving and editing mappings.
- Refreshing field metadata.
- Detecting deleted or unavailable fields.
- Validating field-type compatibility.
- Handling unmapped fields.
- Identifying required mappings before synchronization.

The implementation must support custom fields dynamically wherever possible. Do not hardcode every possible GHL custom field into the application.

If the existing internal CRM cannot represent dynamic fields, inspect the current architecture and propose the minimum necessary extension before making broad schema changes.

### Applying mappings

Use the saved mappings consistently for both import and export operations.

When importing contacts from GHL, map remote values to their corresponding internal fields.

When exporting contacts, map internal values to the correct GHL fields.

Handle missing values, incompatible field types, deleted fields, API errors, and conflicting values safely. Do not silently overwrite existing data without an approved synchronization policy.

## 7. Configurable Contact Synchronization

Connecting GHL must not automatically enable every synchronization operation.

The company administrator must control how contacts move between the CRM and GHL.

### Import from GHL

Allow the administrator to initiate an import from GHL.

The workflow should:

1. Validate the connection.
2. Retrieve contacts through the supported API.
3. Allow the administrator to select the supported import scope.
4. Apply field mappings.
5. Validate the records.
6. Handle duplicates according to the configured policy.
7. Show a preview or summary.
8. Import permitted contacts.
9. Report successful, skipped, and failed records.

### Export to GHL

Allow the administrator to enable or initiate exports from the internal CRM.

The workflow should:

1. Validate the connection and required permissions.
2. Validate the field mappings.
3. Identify eligible contacts.
4. Transform internal records into the appropriate GHL format.
5. Create or update GHL contacts.
6. Record the result.
7. Report errors and support safe retries.

Repeated exports must not create duplicate GHL contacts unnecessarily.

### Synchronization settings

Where supported, allow the company to configure:

- Import enabled or disabled.
- Export enabled or disabled.
- Manual or automatic synchronization.
- Import and export scope.
- Duplicate-handling policy.
- Field mappings.
- Error handling and retry behavior.

Do not enable bidirectional automatic synchronization by default. Implement it only after conflict resolution and loop prevention have been defined and approved.

Contact assignment synchronization must remain disabled unless explicitly configured and supported.

### Disconnecting GHL

When a company disconnects GHL:

- Stop new synchronization operations.
- Disable associated scheduled jobs and webhooks where appropriate.
- Securely remove or revoke credentials where applicable.
- Preserve internal contacts and assignments.
- Preserve relevant audit history.
- Do not delete contacts from either system automatically.

## 8. Configurable Calling Provider

Calling must operate independently of GHL.

A company should be able to use the CRM and its calling provider without connecting GHL.

Create a dedicated **Calling Settings** section within the company Admin Dashboard.

Depending on the selected provider, support the required configuration:

- Provider selection.
- API credentials.
- Account or workspace identifiers.
- Connection details.
- SIP or trunk settings, if required.
- Provider-specific calling settings.
- Calling scripts or workflow configuration, where supported.
- Connection testing, where available.
- Connection status and error reporting.
- Enable or disable controls.

The exact settings must be determined by inspecting the existing calling implementation and the selected provider's official documentation. Do not invent unsupported API parameters.

Implement a provider abstraction so the agent dashboard uses a common internal calling interface rather than depending directly on one provider's API.

Keep credentials server-side.

If no provider is configured, contact management must continue working. Calling controls should explain that calling configuration is required rather than breaking the dashboard.

## 9. Company-Level Integration Isolation

Each company must have independent integration settings, including:

- GHL connection and credentials.
- GHL field mappings.
- Import and export preferences.
- Calling-provider configuration.
- Provider-specific settings.
- Integration status and error history.

Never share one company's credentials or mappings with another company.

Shared integration code is acceptable, but each connection and configuration must be associated with the correct company.

Enforce company membership and authorization on the server and through appropriate Supabase Row Level Security policies.

Never rely only on frontend visibility to protect company data.

## 10. Database Scope for This Phase

Continue using the existing Supabase/PostgreSQL project.

The implementation will require company and membership concepts, but do not decide or implement a separate database or Supabase project for every company in this phase.

Do not implement customer-specific database provisioning or database migration automation for separate customer-owned projects.

Before making major database changes:

1. Inspect the existing schema and relationships.
2. Identify the minimum changes required for companies, roles, and memberships.
3. Identify which contact, assignment, and integration tables can be reused.
4. Document migration risks.
5. Present the proposed changes for approval.

Do not run destructive migrations or delete existing data without explicit approval.

Company-level data isolation is still mandatory in the existing database.

## 11. Mandatory Step-by-Step Implementation Workflow

The coding agent must complete each step independently.

**Never proceed to the next step without my explicit approval.**

### Step 1 — Audit the existing project

Inspect the repository, authentication flow, dashboards, API routes, contact management, assignments, GHL dependencies, calling integration, database access, and security policies.

Report the existing architecture, relevant files, dependencies, risks, and proposed changes.

Do not modify application behavior.

**Stop and wait for approval.**

### Step 2 — Super Admin and company foundation

Implement the Super Admin role, protected dashboard, company creation, and initial company administrator onboarding.

Document required database changes before executing major migrations.

Test authentication, authorization, and company creation.

**Stop and wait for approval.**

### Step 3 — Company Admin and agent management

Adapt the existing Admin Dashboard for company-scoped access.

Implement agent creation by email, onboarding, activation/deactivation, and role validation.

Test administrator and agent login.

**Stop and wait for approval.**

### Step 4 — Internal contacts and assignments

Make the internal CRM the primary contact source.

Implement or adapt manual contact creation, editing, spreadsheet imports, contact assignments, and reassignment.

Ensure agents see only their authorized contacts.

Verify that these workflows work without GHL.

**Stop and wait for approval.**

### Step 5 — Optional GHL integration

Implement company-specific GHL settings, connection testing, field discovery, custom-field mapping, contact import/export, synchronization controls, and error handling.

Test both connected and disconnected company workflows.

**Stop and wait for approval.**

### Step 6 — Calling-provider settings

Inspect the existing calling implementation and identify the exact provider requirements.

Implement company-specific calling configuration and connect it to the existing agent workflow through a provider abstraction.

Verify that calling does not require GHL.

**Stop and wait for approval.**

### Step 7 — Final regression testing

Test all roles, company isolation, contact management, spreadsheet imports, optional GHL integration, field mapping, synchronization, and calling.

Run the available build, lint, type-check, and test commands.

Document results, known issues, and deployment requirements.

**Stop and provide the final verification report. Do not deploy without approval.**

## 12. Rules the Coding Agent Must Follow

- Inspect existing code before editing.
- Reuse working functionality wherever possible.
- Do not rebuild the entire application unnecessarily.
- Do not change unrelated modules.
- Do not delete existing contacts or user accounts.
- Do not make GHL mandatory at any stage of the new architecture.
- Do not expose credentials in frontend code.
- Do not bypass authentication or authorization checks.
- Do not perform destructive database migrations without approval.
- Run relevant tests after each implementation step.
- Report exactly which files changed and which tests passed or failed.
- If requirements are ambiguous, ask before implementing assumptions.
- If a step requires a broader architectural decision, stop and present the options.
- Never start the next step automatically.

## 13. Start Here

Begin with **Step 1: Audit the Existing Project**.

Do not change the database, remove GHL code, or rebuild the dashboards yet.

First inspect the current repository and report:

1. Current architecture and relevant files.
2. Existing authentication and role handling.
3. Current contact and assignment data flow.
4. All important GHL dependencies.
5. Existing calling-provider implementation.
6. Minimum changes required for the multi-company architecture.
7. Risks and recommended implementation sequence.

After presenting the audit report, stop and wait for my explicit approval.

**The project must be implemented incrementally, with my verification and approval after every step.**