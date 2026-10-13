# Implementation Plan — GHL Calling Agent Management System

> **Purpose:** Build a secure, polished, light-theme calling and lead-management web application using Next.js, Supabase, GoHighLevel (GHL), and Crazytel. Implement the system in small, testable stages. Do not skip stages or pretend an integration works before it has been verified against the real account and official documentation.
>
> **Operating rule:** After completing **every stage**, create or update `memory.md` in the repository root with the actual local date, time, stage number/name, what was completed, files changed, tests run and their results, decisions, blockers, and the exact next step. Never claim a stage is complete unless its acceptance criteria pass. Keep `memory.md` concise but useful for the next AI agent/session.

---

## 0. Non-negotiable working instructions

1. **Inspect before changing.** Start by inspecting the repository, package manager, existing routes, components, environment variable names, Supabase setup/migrations, tests, and current implementation. Preserve working code and existing conventions where reasonable.
2. **Do not expose secrets.** Never print, commit, or place API keys, access tokens, OTPs, webhook secrets, phone numbers, or recording URLs in source code, logs, screenshots, `memory.md`, or client bundles. Use `.env.local` locally and the deployment platform's secret manager in production. Keep `.env.example` populated with placeholder values only.
3. **Use official, current documentation.** Verify exact GHL and Crazytel endpoints, authentication requirements, scopes, webhook signatures, event payloads, and account/plan requirements before implementing them. Do not invent endpoints or payload shapes. If documentation/account access is unavailable, implement a typed adapter interface and document the blocker; do not fake a successful live integration.
4. **Server-side enforcement is mandatory.** Hiding UI elements is not authorization. Check permissions on every server action, route handler, API request, recording request, contact reveal, and call initiation.
5. **No secrets in the browser.** GHL/Crazytel credentials and Supabase service-role credentials must remain server-side. Never expose the Supabase service-role key. Use the publishable/anon key only where appropriate with RLS enabled.
6. **Build incrementally.** Each stage must include implementation, tests, a brief manual verification, and a `memory.md` update before moving on.
7. **Do not destructively alter real CRM data during development.** Use a test contact/location/sub-account where possible. Make live write operations opt-in and confirm their effects before running them.
8. **Keep scope honest.** Clearly label mock/demo data. Do not call a mock an integration. Do not start live outbound calls or record real calls without explicit configuration and authorization.

## 1. Product scope and roles

### Owner / manager
- Secure login.
- Admin dashboard with agent activity, work sessions, call statistics, callback queue, qualified leads, and call history.
- Authorized access to call recordings, subject to Crazytel support and applicable recording/privacy rules.
- Review agent work sessions, events, outcomes, comments, and audit history.
- Configure allowed users/roles and business rules.

### Calling agent
- Secure login.
- See only contacts that are both in the configured **Open** state and assigned to that agent's mapped GHL user ID.
- Contact list shows only the minimum approved information: contact name, subject (if the existing CRM has a defined subject field), and masked phone number.
- Reveal only one contact's number at a time if this reveal flow is retained; when another contact is opened, mask the prior number in the UI. Prefer server-initiated calling so the full number does not need to be sent to the browser.
- Start/pause/resume/stop work session according to the agreed policy.
- Initiate calls through Crazytel, submit outcome/disposition and notes, schedule callbacks, and mark leads qualified where permitted.
- View callback tasks assigned to them and receive in-app notifications when due.

### Access rules
- Do not infer application role from email alone.
- Use an explicit approved-user/role mapping. A GHL role or user record is evidence for identity/eligibility, but admin access must also be granted by an application-side allowlist/configuration.
- An agent's allowed GHL user ID must be mapped server-side to the authenticated application user.
- Admin and agent APIs must not return data the caller is not permitted to see.

## 2. Technical architecture

- **Web application:** Next.js using the repository's existing router and TypeScript conventions; use server components/route handlers/server actions where suitable.
- **Database/auth/realtime:** Supabase Auth, Postgres, RLS, and Realtime where helpful.
- **CRM:** GoHighLevel API, using the appropriate supported authentication method and minimum required scopes. Determine whether the current GHL account uses a private integration/token or OAuth; do not assume.
- **Telephony:** Crazytel. Verify the actual account's service configuration, outbound calling method, SIP/WebRTC requirements, caller-ID rules, call events, recordings, and webhook support before selecting the final implementation.
- **Charts:** Use an established charting library already in the project if present; otherwise choose a maintained, accessible React-compatible library.
- **UI:** Premium, clean, **light theme only by default**, responsive, accessible, low-clutter interface.

### Visual design direction
- Warm white / very light neutral canvas, white surfaces, subtle neutral borders, restrained shadows, strong typography, clear hierarchy, generous spacing, polished tables and charts.
- Avoid dark backgrounds, excessive gradients, excessive glassmorphism, emoji-as-icons, and generic card clutter.
- Use a consistent design system: spacing scale, typography scale, radii, focus states, status colors, buttons, inputs, table rows, dialogs, toasts, skeletons, empty states, and error states.
- Use real icons from the project's icon library (for example Lucide if already installed).
- Keep agent calling UI focused: contact queue, masked number, call controls, current call state, disposition/comment form, callback scheduling.
- Admin UI should use a clear navigation sidebar, KPI summaries, useful graphs, filterable tables, and detailed agent/call views. Avoid charts without labels or meaningful context.
- Support keyboard navigation, visible focus indicators, readable contrast, reduced-motion preferences, and responsive layouts.

## 3. Security and privacy requirements

1. Enforce Supabase RLS on every table exposed to the client. Prefer server-only access for sensitive tables and telephony operations.
2. Keep GHL and Crazytel credentials on the server. Validate every inbound webhook using the provider's documented signature/authentication scheme. If no signature is available, use the strongest documented alternative, such as secret URL/header plus network/source verification where practical, and document residual risk.
3. Verify webhook signatures against the **raw request body** when required by the provider. Make handlers idempotent using provider event/call IDs and unique constraints.
4. Never trust client-supplied role, GHL user ID, assigned contact ID, call duration, call status, recording URL, or payable hours. Resolve/verify them server-side.
5. Do not send full phone numbers in contact-list responses. Prefer initiating calls on the server from an authorized contact ID, after verifying assignment and Open status. If a number reveal is a firm requirement, use a short-lived authorized reveal endpoint and understand that anything rendered in a browser can still be captured through DevTools, screenshots, or other means.
6. Browser copy prevention, CSS masking, disabled selection, or hiding values in the DOM are deterrents only; **they cannot guarantee a number is impossible to copy or inspect once sent to the browser**. Minimize disclosure rather than relying on UI tricks.
7. Use short-lived signed recording links if supported, after checking admin permissions. Do not store public recording URLs. Apply retention/access rules and follow applicable Australian call-recording/privacy obligations; get appropriate legal/business approval before enabling recording.
8. Add rate limiting to OTP initiation, reveal/call endpoints, callback mutations, and other abuse-prone endpoints. Avoid leaking whether an arbitrary email exists in the system.
9. Add CSRF protections where relevant, strict input validation, safe output rendering, secure cookie/session settings, and appropriate security headers.
10. Audit privileged actions and sensitive access without logging secret values or full phone numbers.

## 4. Authentication and identity mapping

Recommended flow:
1. User enters their email on the Next.js login page.
2. Server checks whether the email is in the approved-user registry and is eligible to log in. Avoid exposing account membership in public responses.
3. Send/verify a Supabase email OTP (or reuse the existing manager-built authentication flow only if its supported integration and security model are verified). GHL's user list alone does **not** mean an external application can use GHL's own OTP flow as an authentication API.
4. After OTP verification, server maps the normalized verified email to the approved application profile and its GHL user ID. Fetch/refresh GHL user data server-side as appropriate and handle disabled/deleted users.
5. Assign application role using explicit configuration (`admin` or `agent`), not an untrusted client field. Only pre-approved owner/manager identities get admin permissions.
6. Create a secure application session and apply authorization on every protected request.
7. If GHL verification fails or is unavailable, fail closed for initial enrollment/role changes; do not silently grant access based on an email string.

Acceptance criteria:
- Approved admin logs in and reaches admin dashboard.
- Approved agent logs in and reaches agent dashboard.
- Unapproved email cannot access the application even if it can receive an OTP.
- Agent cannot change their role by editing requests or profile fields.
- Removed/disabled user is blocked according to the documented revalidation/session policy.

## 5. GHL integration requirements

Before implementation, verify the current official GHL documentation and account configuration for:
- Users lookup/list/search and available role/identity fields.
- Contact search/list, pagination, location/sub-account scope, and assignment field (often represented by an assigned user ID; verify actual payload).
- Exact meaning of the existing **Open** status: contact custom field, tag, opportunity stage, or another CRM concept. Do not assume.
- Subject field: identify its actual GHL field/meaning or define a product-level fallback.
- Custom field metadata and IDs; reuse existing fields where appropriate.
- Contact update/status update operation.
- Creating a contact note/comment and any supported note retrieval operation.
- Webhook events for contact create/update/assignment/status changes and how to verify webhook authenticity.
- Rate limits, pagination, retries, token refresh/rotation, and API scopes.

Integration behavior:
- Use server-side GHL client/service module with typed requests and responses.
- Never fetch all contacts into the browser and filter there. Filter/authorize server-side, with pagination and a sensible cache/sync strategy.
- Re-check assignment and Open status at the moment of reveal/call initiation and before committing an outcome, so stale cache data does not grant access.
- Use webhooks to keep local data fresh if supported, with scheduled reconciliation as a safety net.
- For every note/status mutation, record the operation and result; handle partial failures and retry safely.
- Do not create duplicate notes or updates on retries. Use idempotency where the API supports it; otherwise implement careful local deduplication.

## 6. Crazytel integration requirements

Do not implement production calling until these have been verified against Crazytel's official documentation and the user's actual account:
- Exact product/service enabled on the account and whether it supports browser WebRTC, SIP credentials, a server-side call-control API, or another integration method.
- Whether the existing Australian number can be used as outbound caller ID under account rules.
- How outbound calls are initiated and authenticated.
- How the browser/agent is associated with a call, including any SIP/WebRTC setup and credential lifecycle.
- Events/webhooks for ringing, answered, completed, failed, busy, no-answer, duration, and unique call identifiers.
- Recording enablement, retrieval, secure playback/download, retention, and access control.
- Webhook signature verification, retries, event ordering, and idempotency.
- Any account plan, caller-ID verification, emergency-calling, concurrency, or usage limits.

Design an adapter such as `CrazytelProvider` with clearly typed methods/events. Keep provider-specific details isolated from UI and business logic. If a feature is not available on the account, show a clear blocked status and document the needed account/API setup rather than simulating it.

Call lifecycle should be server-authoritative wherever possible:
`requested -> ringing -> answered -> completed/failed/cancelled`.
Record provider event IDs and timestamps. Treat browser status as display-only, not proof of a completed call or billable duration.

## 7. Work timer and productivity policy

- Store work sessions in Postgres with server-generated timestamps.
- Keep separate measures for elapsed session time, verified active-call time, idle/pause time, and payable time.
- Set the requested idle threshold to **60 seconds** initially, configurable server-side.
- A verified active call must not be treated as idle merely because the agent does not click the page while speaking.
- Qualifying activity may include server-confirmed call lifecycle events, authorized contact opening, and saved call outcome/comment. Do not count arbitrary mouse movement or synthetic clicks as sufficient proof of work.
- When no qualifying activity occurs for 60 seconds and no active call exists, pause/stop the session according to the chosen policy, record the reason, and display an in-app warning. Browser speech synthesis may announce a warning when browser permissions/support allow it; it is supplementary, not the source of truth.
- Decide and document whether the idle event **pauses** or **ends** a session. Initial recommendation: pause payable time and require an explicit resume action; preserve the full audit history.
- Handle tab close, browser sleep, lost network, duplicate start clicks, multiple sessions/devices, clock skew, and server restarts.
- Do not claim that browser activity proves the person is genuinely working. Use verified call events and audit signals to make time fraud harder, not to claim perfect fraud prevention.
- Admin dashboard should show session timeline, idle pauses, calls, and adjustments transparently. Any manual time adjustment must require an authorized manager and create an audit entry.

## 8. Call outcomes, notes, qualification, and callbacks

- After a call ends, display the configured disposition form: result/status, notes/comments, qualified flag/status, and optional callback date/time.
- Validate callback time, timezone, contact assignment, and status server-side.
- Save each call and disposition as an append-only historical record in Supabase; do not overwrite the only copy of call history.
- Sync relevant latest status and note to GHL using verified supported endpoints. Preserve a retryable sync status so a temporary GHL failure does not lose the result.
- Make synchronization idempotent and expose failures for admin review.
- Callback sidebar should show only callbacks assigned to the logged-in agent, with due/overdue indicators and in-app notifications. Use Realtime or polling as appropriate; browser push notifications are optional and require permissions/service-worker setup.
- When a callback becomes due, notify the agent and provide a one-click path to the authorized contact/call workflow. On completion, save a new call record and update callback state.
- Qualified leads should appear in a separate admin queue and should no longer appear in the agent's Open queue if that matches the agreed GHL status policy.
- Define the canonical set of dispositions and callback timezone policy with the user before hard-coding values.

## 9. Suggested database model

Inspect the existing Supabase schema first and migrate without destroying existing data. Adjust names to match project conventions. Suggested logical tables:

- `profiles`: `id` (auth user ID), normalized email, GHL user ID, application role, active flag, created/updated timestamps.
- `contacts_cache`: GHL contact ID, assigned GHL user ID, current status, safe display fields, sync timestamp. Avoid storing full phone numbers unless there is a justified server-only need.
- `work_sessions`: agent ID, start/end, state, pause/resume times, derived durations, stop reason, server timestamps.
- `activity_logs`: actor ID, event type, relevant internal IDs, timestamp, safe metadata.
- `calls`: provider call ID, agent ID, GHL contact ID, lifecycle state, start/answer/end timestamps, verified duration, outcome, recording reference (not a public URL), sync state.
- `call_dispositions`: call ID, agent ID, outcome, note, qualification status, callback timestamp/timezone, created timestamp.
- `callbacks`: contact ID, agent ID, due timestamp/timezone, status, source call ID, completed timestamp.
- `webhook_events`: provider/source, external event ID, received/processed timestamps, processing state, safe error details; unique constraint for idempotency.
- `audit_logs`: actor, action, target identifiers, timestamp, safe before/after metadata.

Use foreign keys, indexes for assignment/status/due callbacks, unique constraints for external IDs, timestamps, and appropriate retention. Apply RLS and test both allowed and denied access. Keep service-role operations on the server only. Do not blindly copy every GHL field into Supabase.

## 10. Admin dashboard and reporting

Include:
- KPI summaries: hours by category, calls placed/answered, average call duration, outcomes, qualified leads, callbacks due/overdue, and sync failures.
- Date range, agent, outcome, and status filters.
- Charts with readable labels, meaningful units, tooltips, and accessible alternatives.
- Agent table with current session state and drill-down timeline.
- Call history with authorized recording playback, if available.
- Qualified leads and callback monitoring.
- Audit and integration health views.
- Clear loading, empty, stale-data, permission-denied, and error states.

Metrics must be computed from persisted server/provider events, not from untrusted browser counters. Document each metric's formula so managers understand what is counted.

## 11. Implementation stages and gates

### Stage 1 — Repository discovery and baseline
- Inspect repository, package scripts, dependencies, current UI, routing, environment configuration, Supabase state/migrations, and test setup.
- Run existing lint/typecheck/tests/build where available and record baseline failures before editing.
- Create a concise `PROJECT_STATUS.md` only if useful; do not duplicate `memory.md`.
- **Acceptance:** documented architecture and baseline; no code changes that break existing behavior.

### Stage 2 — Product decisions and integration verification
- Verify official GHL and Crazytel docs and identify account-specific unknowns.
- Confirm Open-status source, subject field, roles/approved users, Crazytel call method, recording/events availability, callback timezone, and idle pause/stop policy.
- Create `docs/INTEGRATION_REQUIREMENTS.md` listing exact confirmed endpoints/scopes/events and unresolved blockers. Do not invent answers.
- **Acceptance:** every external dependency is either verified or explicitly marked blocked with the exact information needed from the owner.

### Stage 3 — Design system and responsive app shell
- Implement light-theme tokens and reusable components.
- Build responsive auth shell, sidebar/navigation, page headers, tables, forms, dialogs, toasts, skeletons, empty states, and error states.
- Use clearly labeled mock data only for layout previews; visually mark mocks in development.
- **Acceptance:** polished desktop/tablet/mobile layout, keyboard accessibility, no dark default theme, lint/typecheck pass.

### Stage 4 — Supabase schema, RLS, and test fixtures
- Add versioned migrations for approved tables, constraints, indexes, and RLS policies.
- Create test fixtures that do not contain real customer data.
- Test agent-vs-agent and agent-vs-admin access boundaries, including direct API attempts.
- **Acceptance:** migrations apply cleanly; denied-access tests pass; service-role key remains server-only.

### Stage 5 — Authentication and GHL identity mapping
- Implement email OTP and secure sessions.
- Add server-side approved-user/role mapping to GHL user IDs.
- Build admin/agent route protection and logout/session expiry handling.
- **Acceptance:** approved admin and agent route correctly; unapproved email and role escalation attempts fail.

### Stage 6 — GHL read integration and contact queue
- Implement typed GHL client, safe pagination, retry/rate-limit handling, and contact sync/cache.
- Resolve actual Open field/stage and assignment semantics.
- Enforce Open + assigned-user filtering on the server and re-check at reveal/call time.
- **Acceptance:** integration tested against authorized test contacts; an agent cannot retrieve another agent's contacts by changing IDs or requests.

### Stage 7 — Contact detail and privacy-preserving call initiation
- Build contact queue and single-active-contact UI.
- Return only safe display fields; implement server-side reveal/call authorization.
- Add mask-on-switch behavior, loading/error states, and audit events.
- **Acceptance:** list API does not disclose full numbers; authorization is enforced server-side; document residual browser/screenshot risks if a number is ever rendered.

### Stage 8 — Crazytel adapter and calling lifecycle
- Implement only after account capabilities and API/SIP/WebRTC method are verified.
- Add provider configuration, secure call initiation, call lifecycle state machine, error handling, and test-mode guard.
- Test with an explicitly approved test destination before any production call.
- **Acceptance:** real provider events map to the correct call and agent; failed/duplicate/out-of-order events are handled safely; no fake call-success state.

### Stage 9 — Webhooks, call history, and recordings
- Add validated, idempotent GHL/Crazytel webhook handlers.
- Store provider call IDs, lifecycle events, duration, recording reference, and sync status.
- Add permission-checked recording access if Crazytel provides it.
- **Acceptance:** duplicate webhook test creates no duplicate call; invalid signature/authentication is rejected; recordings are not publicly exposed.

### Stage 10 — Dispositions, notes, qualification, and GHL sync
- Build post-call form and canonical outcome model.
- Persist immutable call outcomes in Supabase and sync approved fields/notes to GHL.
- Add retry queue and admin-visible sync failures.
- **Acceptance:** outcome survives temporary GHL outage and sync retry does not duplicate notes or history.

### Stage 11 — Work sessions, idle detection, and voice warning
- Implement server-timestamped work sessions and 60-second no-qualifying-activity pause/stop policy.
- Exempt verified active calls from idle timeout.
- Add visible warning and optional speech synthesis announcement.
- Add resume flow, lost-connection handling, and audit timeline.
- **Acceptance:** fake browser timer cannot determine payable hours; active calls do not auto-pause; idle sessions pause/stop at configured threshold and are auditable.

### Stage 12 — Callback queue and notifications
- Add callback create/update/complete flows, timezone-safe scheduling, due/overdue badges, and in-app notifications.
- Add optional push notifications only if explicitly configured and tested.
- **Acceptance:** only assigned agents see their callbacks; due-time calculations work across daylight-saving changes; completion creates a traceable result.

### Stage 13 — Admin analytics and audit UI
- Add KPI calculations, filters, charts, agent drill-down, call history, qualified leads, callbacks, integration health, and audit logs.
- Define metric formulas and display time zone.
- **Acceptance:** metrics reconcile with stored test events; filters work; sensitive details are permission-checked.

### Stage 14 — Hardening and end-to-end tests
- Test auth abuse, role escalation, IDOR, RLS, webhook spoofing, duplicate events, rate limits, session expiry, network loss, concurrency, mobile responsiveness, keyboard access, and error recovery.
- Run lint, typecheck, unit/integration tests, production build, and migrations against a safe test environment.
- Review privacy/recording requirements and operational monitoring.
- **Acceptance:** all critical tests pass or are clearly documented as blocked; no secrets or real customer data in repo/logs.

### Stage 15 — Deployment and handover
- Document environment variables by name only, secret setup, Supabase migration process, GHL/Crazytel setup, webhook URLs, test procedure, rollback plan, and known limitations.
- Deploy only after the owner approves production configuration and test-call plan.
- **Acceptance:** production health checks pass, integrations are verified, and handover documentation is complete.

## 12. Required `memory.md` checkpoint format

After **each** stage, create/update repository-root `memory.md`. Use the actual timestamp from the environment at the moment the stage is completed, including timezone. Do not reuse a stale timestamp. Suggested format:

```md
# Implementation Memory

## Latest checkpoint
- Date: YYYY-MM-DD
- Time: HH:MM:SS TZ (include UTC offset if available)
- Stage: Stage N — Name
- Status: COMPLETE | BLOCKED | IN PROGRESS

### Completed
- Specific implementation work that actually exists.

### Files changed
- `path/to/file` — reason for change.

### Verification
- Command/test: result (PASS/FAIL/NOT RUN).
- Manual check: result.

### Decisions and assumptions
- Confirmed decisions; clearly label assumptions.

### Blockers / owner input needed
- Exact unresolved item, if any. Never record secrets or full customer data.

### Next step
- The next specific task, and its acceptance criteria.
```

If work is interrupted mid-stage, record `IN PROGRESS` or `BLOCKED` and the precise unfinished item. Do not mark a stage complete just to move forward. Keep older checkpoints as a short dated history beneath the latest checkpoint so progress is not lost.

## 13. Final delivery expectations

- Working source code, migrations, tests, and documentation; no dead buttons or fake integrations.
- A polished, responsive light UI consistent across all pages.
- Clear `.env.example` with placeholders and a deployment setup guide.
- `memory.md` updated after every stage with real timestamp and verified progress.
- A final summary of implemented stages, test results, required account-side setup, unresolved limitations, and safe next steps.

**Begin with Stage 1 only.** Inspect the existing project, record baseline results, and update `memory.md`. Do not proceed through all stages in one unverified batch.
