# Implementation Memory

## Latest checkpoint
- Date: 2026-10-13
- Time: 12:50:18 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Crazytel Hybrid SIP WebRTC calling
- Status: SIP.JS FLOW IMPLEMENTED AND BUILDS; LIVE DIALING BLOCKED UNTIL HYBRID CREDENTIALS/OUTBOUND URI AND MIGRATION 000014

### Completed
- Replaced the in-CRM simulated timer with SIP.js WebRTC signaling, mic permission, Hybrid WSS registration, ringing/connected states, remote audio, and SIP BYE/CANCEL hangup. The phone OS dialer is not used.
- Server revalidates the contact assignment/Open state before call creation, and returns WebRTC settings only to the signed-in agent. Crazytel API key remains server-only and is used for a read-only Settings balance/authentication check only.
- Added explicit `CRAZ YTEL_OUTBOUND_URI_TEMPLATE`-gated target construction; template is blank until Crazytel confirms PSTN dial syntax. SIP Call-ID is associated with the DB call through a server RPC so real WebRTC calls can exempt idle timer. Admin displays Crazytel WebRTC separately while duration remains honestly agent-reported.
- Added `20261013_000014_crazytel_sip_call_timer.sql` to associate SIP Call-ID and exempt linked calls from idle pause; documented account setup, credential limitations, and CDR/webhook verification blockers.
- Updated `.env.local` API base URL and added blank Hybrid WebRTC keys without printing existing credential values; removed obsolete API secret and generic outbound SIP key names.

### Files changed
- `src/app/contacts/[id]/agent-call-workflow.tsx`, `src/app/open-queue/agent-contact-list.tsx` — SIP.js WebRTC audio calling.
- `src/app/api/calls/manual/route.ts`, `src/lib/crazytel.ts`, `src/lib/crazytel-utils.ts`, `src/lib/crazytel.test.ts` — secure SIP config/Call-ID integration and target validation.
- `src/app/settings/page.tsx`, `src/app/settings/settings-console.tsx`, `src/app/api/admin/integrations/check/route.ts`, `src/lib/env.ts`, `.env.example`, `.env.local` — Crazytel config/status and read-only API-key test.
- `src/app/agents/[id]/page.tsx`, `supabase/migrations/20261013_000014_crazytel_sip_call_timer.sql` — admin call-source reporting and SIP call timer linkage.
- `docs/CRAZYTEL_WEBRTC_SETUP.md`, `docs/INTEGRATION_REQUIREMENTS.md`, `docs/SUPABASE_SETUP.md`, `memory.md` — verified setup and outstanding account-specific items.

### Verification
- `npm test` — PASS (4 files, 23 tests).
- Full `npm run lint` — PASS.
- `npx tsc --noEmit --incremental false --pretty false` — PASS.
- `npm run build` — PASS; `/api/calls/manual` and `/settings` compile.
- Local app restarted; `/login` returned HTTP 200. No SIP call or Crazytel API request was made during tests.
- `.env.local` presence-only check: API key/base URL/WSS present; SIP URI/password/outbound URI template empty. No values printed.

### Next step
- Copy Hybrid WebRTC username and WebRTC password from Crazytel MyAccount, obtain exact outbound Request-URI pattern from Crazytel support, fill the matching keys in `.env.local`, apply migrations with `npx supabase db push`, then test only with an approved destination.

## Previous checkpoint
- Date: 2026-10-13
- Time: 11:54:01 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Agent personal work-session history
- Status: COMPLETE AND VERIFIED; SERVED ON LOCAL PORT 3000

### Completed
- Added `/my-sessions` as an agent-only page with session count, combined active/idle totals, current session state, Australian-local start/end times, active/idle visual breakdown, and recorded pause reasons.
- Added `My sessions` to the agent workspace navigation. The page redirects admins away and scopes its database read to the authenticated agent's profile ID.

### Files changed
- `src/app/my-sessions/page.tsx`, `src/app/my-sessions/my-sessions.module.css` — private personal session history view.
- `src/components/workspace-shell.tsx` — agent navigation link and sessions section permission.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (3 files, 20 tests).
- `npm run lint` — PASS.
- `npx tsc --noEmit --incremental false --pretty false` — PASS.
- `npm run build` — PASS; `/my-sessions` included in route output.
- Local server restarted; `/login` returned HTTP 200.

### Next step
- Sign in as an agent, open `My sessions` from the sidebar, and confirm the page shows only that agent's own records.

## Previous checkpoint
- Date: 2026-10-11
- Time: 16:22:32 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Work-session idle and admin live-time accuracy
- Status: CODE COMPLETE AND VERIFIED; APPLY MIGRATION 000013 FOR IDLE AUTO-PAUSE FIX

### Completed
- Root cause: work-session SQL treated agent-reported in-app demo calls as active calls (up to two hours), exempting the timer from idle pause even though no real phone/provider call was active. New append-only migration 000013 only exempts verified provider calls.
- Admin profile previously summed persisted `active_seconds` only, omitting the current active interval and any not-yet-committed idle interval. It now calculates elapsed active/idle time from state-change and last-activity timestamps and labels an active row `Idle · pause pending` when activity is 60+ seconds old.
- Added a distinct amber idle-pending timeline state and documented the required migration.

### Files changed
- `supabase/migrations/20261011_000013_demo_calls_do_not_hold_work_timer.sql` — idle auto-pause no longer exempts in-app demo call logs.
- `src/app/agents/[id]/page.tsx`, `src/app/agents/[id]/agent-detail.module.css` — reconcile current/overdue active and idle time for admin display.
- `docs/SUPABASE_SETUP.md`, `memory.md` — migration instructions and checkpoint.

### Verification
- `npm test` — PASS (3 files, 20 tests).
- `npm run lint` — PASS.
- `npx tsc --noEmit --incremental false --pretty false` — PASS.
- `npm run build` — PASS; local app restarted and `/login` returns HTTP 200.
- Supabase migration has not been applied from this workspace; authenticated timer behavior was not exercised after application.

### Next step
- Run `npx supabase db push` against the same Supabase project as the app, reload the agent page, and verify a demo call no longer exempts idle pause and admin active/idle totals match the stored timeline.

## Previous checkpoint
- Date: 2026-10-11
- Time: 16:05:24 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Agent session timeline visual redesign
- Status: COMPLETE, VERIFIED, AND SERVED ON LOCAL PORT 3000

### Completed
- Replaced plain work-session log rows with a timeline: current/completed state, start/end time pair, active-vs-idle duration bar and legend, and reason label.
- Added responsive narrow-screen treatment for session timestamps and timeline rows.

### Files changed
- `src/app/agents/[id]/page.tsx` — session timeline markup and Australian-local time rendering.
- `src/app/agents/[id]/agent-detail.module.css` — timeline rail, state indicators, duration bars, responsive layout.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (3 files, 20 tests).
- `npm run lint` — PASS.
- `npx tsc --noEmit --incremental false --pretty false` — PASS.
- `npm run build` — PASS; server restarted, `/login` returns HTTP 200.
- Authenticated screenshot was not available to this editor browser; user shared an image of the previous session section.

### Next step
- Hard refresh the admin agent profile and review the redesigned Session timeline section.

## Previous checkpoint
- Date: 2026-10-11
- Time: 15:41:22 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — GHL call custom-field key mismatch
- Status: CONFIGURATION FIXED AND SERVER RESTARTED; NEXT CALL IS READY TO RETEST

### Completed
- Diagnosed the partial-save message: Supabase had already saved the call stage/note; only GHL contact synchronization failed because `.env.local` used shorthand Notes/Callback keys while GHL metadata returns contact-prefixed keys.
- Read-only request to the configured GHL location returned HTTP 200 and confirmed metadata keys `contact.call_stage`, `contact.call_notes`, and `contact.callback_at`.
- Updated the two mismatched `.env.local` values without exposing or changing credentials, then restarted the existing `next start` server so it reloads the settings.
- Added regression coverage for resolving these exact contact-prefixed keys.

### Verification
- `src/lib/ghl-contact-data.test.ts` — PASS (13 tests).
- Local `/login` health check after restart — HTTP 200.
- No GHL contact was updated during diagnosis. The previously failed GHL sync is not automatically replayed; its stage/note remains saved in Supabase.

### Next step
- Test a new call outcome on an approved test contact and confirm GHL updates Call Stage and Call Notes. Retry or manually update the earlier contact separately if that old result must be reflected in GHL.

## Previous checkpoint
- Date: 2026-10-11
- Time: 15:33:06 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — In-app simulated call timer and end-before-disposition
- Status: CODE COMPLETE AND VERIFIED; APPLY MIGRATION 000012 BEFORE AUTHENTICATED TESTING

### Completed
- Removed `tel:` navigation from the manual call flow. Clicking Call now opens an in-CRM demo-call dialog with a running timer; it explicitly says no phone dialer/Crazytel connection is active.
- The End call action records end time and duration through a server-only RPC before the stage/notes dialog appears. Phone numbers are no longer returned by the call-start API.
- Added append-only migration `20261011_000012_end_call_before_disposition.sql`, requiring saved dispositions to belong to an ended agent-reported call. Documented it in Supabase setup.

### Files changed
- `src/app/contacts/[id]/agent-call-workflow.tsx`, `src/app/contacts/[id]/contact-profile.module.css` — in-app active-call modal/timer and stage dialog.
- `src/app/open-queue/agent-contact-list.tsx`, `src/app/open-queue/agent-contact-list.module.css` — queue Call button starts the in-app dialog.
- `src/app/api/calls/manual/route.ts` — server-authoritative end action and ended-call disposition guard; no phone in start response.
- `supabase/migrations/20261011_000012_end_call_before_disposition.sql`, `docs/SUPABASE_SETUP.md`, `memory.md` — migration and operational instructions.

### Verification
- `npm test` — PASS (3 files, 19 tests).
- Focused ESLint and `npx tsc --noEmit --incremental false --pretty false` — PASS.
- `npm run build` — PASS.
- Authenticated UI and database RPC not exercised; the shared browser page is not logged in, and migration 000012 has not been applied from this workspace.

### Next step
- Apply pending migrations with `npx supabase db push`, sign in as an agent, then verify Call opens the in-app timer, End freezes the server duration, and stage/note save reaches Supabase and configured GHL fields.

## Previous checkpoint
- Date: 2026-10-11
- Time: 15:22:18 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Start calls from the agent queue
- Status: COMPLETE AND VERIFIED LOCALLY; LIVE DIALER BEHAVIOR REQUIRES AGENT BROWSER TEST

### Completed
- Replaced the agent queue's direct `tel:` anchor, which bypassed call logging and the outcome dialog, with a call button that posts to the manual-call API, opens the device dialer, and mounts the shared call workflow in that contact row.
- After the agent returns and marks the call ended, the shared flow opens the stage/message dialog. Other queue calls are disabled until the saved call is complete; GHL sync/save confirmation remains visible in the queue.

### Files changed
- `src/app/open-queue/agent-contact-list.tsx`, `src/app/open-queue/agent-contact-list.module.css` — start calls from queue and display the row workflow.
- `src/app/contacts/[id]/agent-call-workflow.tsx` — reusable logged-call start helper and support for a queue-started call.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (3 files, 19 tests).
- Focused ESLint and full TypeScript check — PASS.
- `npm run build` — PASS.
- Authenticated browser call test not run; shared browser tab is on login.

### Next step
- Reload `/open-queue` as an agent, reveal a contact number, click its Call button, confirm the phone app opens, return, then test Call ended and save a stage/message.

## Latest checkpoint
- Date: 2026-10-11
- Time: 14:55:26 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Admin current contact queue and call-stage/GHL sync
- Status: CODE COMPLETE AND VERIFIED; APPLY MIGRATION 000011 AND CONFIGURE GHL CONTACT FIELDS BEFORE LIVE SYNC

### Completed
- Admin agent detail now loads the same current GHL-assigned + Open contacts as that agent's queue, with cursor navigation and masked phone values. Historical assignment events remain separate.
- Start Call records the manual call, then opens the device `tel:` handler; the Dial link remains as a fallback. Replaced the inline outcome form with a result dialog for Picked, Not picked, Call later, Busy, or Interested, plus call notes. Call later requires a scheduled callback date/time.
- Added server validation and a new append-only migration for the stage outcomes. Manual duration and outcomes remain agent-reported, not provider-verified.
- Added server-side GHL contact-field sync configuration. Supabase saves the full call history first; GHL fields hold the latest stage/notes/callback snapshot. Sync state is recorded in `calls.sync_state` and partial failures are shown to the agent.
- Documented field setup in `docs/GHL_CALL_FIELDS.md` and migration/configuration in `docs/SUPABASE_SETUP.md`.

### Files changed
- `src/app/agents/[id]/page.tsx` — current assigned Open contacts on admin agent detail.
- `src/app/contacts/[id]/agent-call-workflow.tsx`, `src/app/contacts/[id]/contact-profile.module.css`, `src/app/api/calls/manual/route.ts` — call result dialog, stage validation, local save and GHL sync response.
- `src/lib/ghl.ts`, `src/lib/env.ts`, `.env.example` — GHL custom-field resolution and server-only configuration.
- `supabase/migrations/20261011_000011_call_stage_outcomes.sql` — new stage values and secure RPC behavior.
- `docs/GHL_CALL_FIELDS.md`, `docs/SUPABASE_SETUP.md`, `memory.md` — setup instructions and checkpoint.

### Verification
- `npm test` — PASS (3 files, 19 tests).
- `npm run lint` — PASS.
- `npx tsc --noEmit --incremental false --pretty false` — PASS after correcting stale callback-stage comparisons.
- `npm run build` — PASS; `/agents/[id]` and `/api/calls/manual` compile.
- Live GHL sync, database migration application, and authenticated browser workflow were not exercised.

### Next step
- Create the three Contact custom fields in GHL, set their exact keys in server environment variables, apply migration 000011 with `npx supabase db push`, then test with an approved contact and verify both the Supabase call history and GHL fields.

## Previous checkpoint
- Date: 2026-10-11
- Time: 14:21:54 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Agent session history and phone copy deterrents
- Status: UI COMPLETE AND VERIFIED; DEVTOOLS-PROOF PHONE HIDING IS NOT POSSIBLE WHILE REVEALING IN BROWSER

### Completed
- Timer API now returns up to 10 of the authenticated agent's own ended work sessions. After End, the timer refreshes its history and displays each session's start date/time, end time, saved active duration, and idle duration.
- Added shared `ProtectedPhone` rendering for numbers after explicit reveal across My contacts, contact details, and callbacks. It blocks ordinary copy/cut, text selection, drag, context menu, and keyboard copy gestures.
- Did not claim DevTools-proof prevention: a phone number sent to a browser can still be inspected in network responses or runtime state. Actual prevention requires server-side calling without returning the number, which remains blocked pending verified provider call support.

### Files changed
- `src/app/api/work-sessions/route.ts` — return authenticated agent's own recent ended rows with the active session.
- `src/app/open-queue/work-session-timer.tsx`, `src/app/open-queue/work-session-timer.module.css` — render and refresh dated agent session history after End.
- `src/components/protected-phone.tsx`, `src/components/protected-phone.module.css`, `src/app/open-queue/agent-contact-list.tsx`, `src/app/contacts/[id]/agent-phone-reveal.tsx`, `src/app/callbacks/callback-list.tsx`, `src/app/contacts/[id]/contact-profile.module.css` — ordinary browser copy deterrents on revealed numbers.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (3 files, 19 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS.
- No migration or provider/database record was modified during this request.

### Next step
- Reload as an agent, end a session, and verify its date/time and active/idle durations appear under Work session. Test standard copy/context-menu gestures on a revealed number; do not represent this as DevTools-proof.

## Previous checkpoint
- Date: 2026-10-10
- Time: 15:14:10 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — PostgreSQL 42702 work-session RPC ambiguity
- Status: CODE COMPLETE; APPLY MIGRATION 000006 TO THE APP'S SUPABASE PROJECT

### Completed
- Confirmed the reported PostgreSQL error `42702` (`column reference "active_seconds" is ambiguous`) matches the old migration's `active_seconds = active_seconds` update expression.
- Added a new append-only migration `20261010_000006_qualify_work_session_columns.sql`. It replaces the RPC and qualifies table-column references, including `ws.idle_seconds`, while preserving manual End/Pause, legacy session fallback timestamps, active-call exemption, and excluding idle duration from active seconds.
- Left migrations `000004` and `000005` unchanged.
- Updated the API's 42702 response and Supabase setup instructions to identify migration 000006 explicitly.

### Files changed
- `supabase/migrations/20261010_000006_qualify_work_session_columns.sql` — fully replace ambiguous timer RPC.
- `src/app/api/work-sessions/route.ts` — point ambiguity message at the actual next migration.
- `docs/SUPABASE_SETUP.md` — document 42702 follow-up.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (3 files, 19 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS.
- Confirmed migration sequence now includes `000006`; remote Supabase migration was not run from this workspace.

### Next step
- From the project root, run `npx supabase db push` against the same linked Supabase project used by the running app, then reload and press End on the existing session. Confirm subsequent `POST /api/work-sessions` requests stop returning 42702/503.

## Previous checkpoint
- Date: 2026-10-10
- Time: 14:42:58 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Separate work-session RPC correction migration
- Status: CODE COMPLETE; NEW MIGRATION MUST BE APPLIED TO SUPABASE

### Completed
- Left `20261010_000004_work_session_controls.sql` unchanged and added a new migration `20261010_000005_fix_work_session_rpc.sql`.
- Corrected the PL/pgSQL variable/column name collision by using `v_active_seconds`, which affected End, Pause, and idle auto-pause RPC calls.
- For legacy active sessions, timing uses `coalesce(state_changed_at, started_at)`. Auto-pause only accumulates active seconds through the last qualifying activity, not through the idle interval; idle seconds record the actual elapsed idle period (minimum 60).
- Added the migration to Supabase setup instructions as an append-only pending migration; already-applied migrations must not be edited or rerun.

### Files changed
- `supabase/migrations/20261010_000005_fix_work_session_rpc.sql` — replace the broken RPC with ambiguity-free session control logic.
- `docs/SUPABASE_SETUP.md` — instructions for applying pending migration 000005.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (3 files, 19 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS.
- Supabase migration was not applied from this workspace; no project credentials/access were used.

### Next step
- Apply pending migrations with `npx supabase db push` to the linked intended Supabase project. Then retry End on the existing session; confirm an idle active session pauses after the next server check and its idle time is not counted as active time.

## Previous checkpoint
- Date: 2026-10-10
- Time: 14:38:07 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Idle timer failed-check visibility and immediate server evaluation
- Status: COMPLETE LOCALLY; LIVE SESSION VERIFICATION REQUIRES APPLIED SUPABASE MIGRATION

### Completed
- Active sessions now invoke a server idle check immediately when loaded/resumed, then every 15 seconds. An already-idle session should pause on its first successful check rather than waiting another full minute.
- Non-success responses from the idle RPC are no longer silently ignored; the agent sees an idle-protection warning and is told to apply the timer migration and manually pause while protection is unavailable.
- Existing database decision remains authoritative: 60 seconds since the last server-recorded qualifying activity pauses the session unless an open requested/ringing/answered call exists.

### Files changed
- `src/app/open-queue/work-session-timer.tsx` — immediate idle RPC check, recurring polling, and visible RPC failure state.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (3 files, 19 tests).
- `npm run lint` — PASS.
- `npx tsc --noEmit --incremental false --pretty false` — PASS.
- `npm run build` — PASS.
- No authenticated live timer request was possible from this session.

### Next step
- Confirm migration `20261010_000004_work_session_controls.sql` has been applied. Refresh the active agent page; if the visible idle-protection warning appears, migration/RPC execution is unavailable. With migration active and no call/qualifying action for 60 seconds, confirm status changes to Paused.

## Previous checkpoint
- Date: 2026-10-10
- Time: 14:11:20 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Agent data minimization, one-at-a-time number reveal, and work timer UI
- Status: CODE COMPLETE; SUPABASE MIGRATION MUST BE APPLIED BEFORE TIMER/REVEAL AUDIT WORKS

### Completed
- Agent contact queue now receives only an approved projection: name, suburb, masked number, status, and internal ID needed for navigation. It does not serialize email, subject, or full phone. Search is limited to name/suburb.
- Full contact numbers are returned only by authenticated, rate-limited endpoints that re-fetch GHL and revalidate agent assignment. Contact detail checks the requested contact directly; callback reveal validates callback ownership and current GHL assignment. Successful reveals write an activity event without storing the number, return no-store responses, and auto-hide in the UI after 30 seconds. Only one queue/callback number is visible at once.
- Agent contact profile omits email, internal contact ID, subject, and assigned-agent details; shows name/suburb and masked phone with explicit reveal. Admin profile remains unchanged.
- Agent callback cards now receive masked phone and suburb, omit internal contact IDs from serialized props and UI, and provide the same authorized single-number reveal. Agents are redirected away from standalone session/disposition pages, retaining only My contacts and My callbacks navigation.
- Added a persisted work-session timer in the shared agent shell with start/pause/resume/end controls, server-calculated active seconds, 60-second idle pause, active-call exemption, qualifying authorized activity updates, best-effort page-hide pause, and confirmation before ending.
- Added migration `supabase/migrations/20261010_000004_work_session_controls.sql` for timer fields/RPC and privacy-safe phone-reveal audit. The migration was not applied to Supabase.
- Added regression tests for suburb parsing, removal of email/full phone from agent projections, and masking very short phone values.

### Files changed
- `src/lib/ghl-contact-data.ts`, `src/lib/ghl-contact-data.test.ts`, `src/lib/ghl.ts`, `src/lib/work-session-activity.ts` — suburb, safe projection, exact assignment revalidation, session activity and reveal audit helpers.
- `src/app/open-queue/agent-contact-list.tsx`, `src/app/open-queue/agent-contact-list.module.css`, `src/app/open-queue/work-session-timer.tsx`, `src/app/open-queue/work-session-timer.module.css`, `src/app/open-queue/page.tsx`, `src/components/workspace-shell.tsx` — minimal agent contacts, reveal UI, persisted timer.
- `src/app/contacts/[id]/page.tsx`, `src/app/contacts/[id]/agent-phone-reveal.tsx`, `src/app/contacts/[id]/contact-profile.module.css`, `src/app/contacts/[id]/actions.ts`, `src/app/api/contacts/[id]/reveal/route.ts` — agent profile minimization and reveal route.
- `src/app/callbacks/page.tsx`, `src/app/callbacks/callback-list.tsx`, `src/app/callbacks/callback-list.module.css`, `src/app/api/callbacks/[id]/route.ts` — callback privacy/reveal.
- `src/app/api/work-sessions/route.ts`, `src/app/sessions/page.tsx`, `proxy.ts`, `supabase/migrations/20261010_000004_work_session_controls.sql`, `memory.md` — timer APIs/persistence, role navigation limits, migration/checkpoint.

### Verification
- `npm test` — PASS (3 files, 19 tests).
- `npm run lint` — PASS.
- `npx tsc --noEmit --incremental false --pretty false` — PASS.
- `npm run build` — PASS; new reveal/timer routes compile.
- Live endpoint permission tests and Supabase migration execution were not run; no customer phone was fetched/revealed and no provider data was modified during verification.

### Decisions and limitations
- GHL `city` is used as the suburb fallback; an explicitly named custom field containing `suburb` is also supported. If neither source field is populated, UI displays a dash.
- A revealed number is delivered to the browser, so it cannot be made impossible to inspect or capture. Reveal is minimized, authorized, audited, rate-limited, no-cache, restricted to one active number in the UI, and automatically hidden after 30 seconds.
- The browser timer is display-only; server timestamps are authoritative. Idle checks are initiated by the active workspace polling every 15 seconds, with best-effort pause on page hide. If the browser/device is entirely offline or terminated, no browser request can fire at the exact idle threshold. The policy does not claim that browser activity proves payable work.
- Calling provider remains unverified; `tel:` link is available only after number reveal. `Start call` remains honestly blocked until provider setup is verified.

### Blockers / owner action needed
- Review and apply `supabase/migrations/20261010_000004_work_session_controls.sql` to the intended Supabase project using the documented `npx supabase db push` flow in `docs/SUPABASE_SETUP.md`; then restart the app.
- Verify agent number reveal, callback reveal, audit event, timer start/pause/resume/idle/active-call exemption/end with approved test accounts and contacts.

### Next step
- Apply the migration on the approved development Supabase project, sign in as an agent, verify timer and reveal interactions, then confirm admin can inspect the audit event without any phone number stored in metadata.

## Previous checkpoint
- Date: 2026-10-10
- Time: 12:51:47 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Agent queue availability diagnosis
- Status: COMPLETE LOCALLY; ACTUAL AGENT PROFILE MAPPING NEEDS AUTHENTICATED RUNTIME CONFIRMATION

### Completed
- Replaced the generic agent queue outage text with safe messages for missing app-to-calling-account mapping, incomplete contact-status setup, denied access, or other contact-read failures. Agent-visible text avoids provider/internal setting terminology.
- Confirmed dashboard Agent performance lists active agent profiles even when `ghl_user_id` is null, while the secure queue requires that mapping to match GHL's `assignedTo` ID. Existing setup documentation explicitly permits null mappings until the GHL user identity is verified.
- Kept access fail-closed; did not guess an identity from an email or return other users' contacts. Official Search Users docs require `companyId`; the available location docs do not verify that it can be derived, so automatic email-to-ID resolution was not added.

### Files changed
- `src/app/open-queue/page.tsx` — show safe actionable queue-unavailable reasons.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (3 files, 16 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS.
- Did not query or modify `.env.local`, Supabase user rows, or GHL contacts.

### Next step
- Refresh `/open-queue`. If it says the login is not linked, an administrator must set that agent profile's `ghl_user_id` to the verified GHL user ID. If it reports a different safe cause, follow that message. Then confirm the contact status remains Open and reload the agent queue.

## Previous checkpoint
- Date: 2026-10-10
- Time: 12:31:28 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 follow-up — Use active dashboard agents for assignment
- Status: COMPLETE LOCALLY; LIVE GHL WRITE/READ ROUND TRIP STILL REQUIRES AN APPROVED TEST CONTACT

### Completed
- Replaced the failed GHL users-list roster dependency with active Supabase `agent` profiles. The sidebar shows the same active agent profiles used by Agent performance, including profiles without GHL mappings with a clear setup state.
- Kept contact assignment limited to active profiles with non-null GHL user IDs. The admin contacts page/API and server-side PATCH validation use the same mapped-agent resolver.
- Confirmed the existing write path sends the selected GHL ID as `assignedTo` via GHL contact update. The agent queue reads GHL and filters by the authenticated profile's mapped GHL ID plus configured Open status.
- Removed `GHL_COMPANY_ID`, the `/users/search` roster implementation, its parser/tests, and related Settings/deployment configuration. No `.env.local` values were read or changed.

### Verification
- `npm test` — PASS (3 files, 16 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS.
- Live GHL contact mutation/read-back was not run; no contact was changed during verification.

### Remaining verification
- Sign in as admin and confirm sidebar users match Agent performance; mapped agents should be assignable while unmapped profiles are disabled/not listed in assignment controls.
- Assign an approved test contact, verify GHL shows the selected Assigned Agent, ensure its status is Open, then sign in as that agent and verify it appears in My contacts. Do not use a production contact without approval.

## Previous checkpoint
- Date: 2026-10-10
- Time: 00:19:54 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 21 — Terraverse CRM dashboard, contact history, and role-verified GHL user roster
- Status: SUPERSEDED BY THE ACTIVE-PROFILE FOLLOW-UP ABOVE

### Completed
- Applied Terraverse green/neutral shared UI tokens, improved the responsive workspace shell and reusable buttons, search, filters, badges, alerts, avatars, skeletons, and confirmation dialog. Admin Settings now uses the shared shell; agents retain only My contacts and My callbacks navigation.
- Improved admin dashboard metric provenance, added exact due/overdue callback counts, and aligned call charts to persisted call states. Contact rows show provider-supplied last activity and latest saved call dates; admin call details have a dedicated page and contact histories use database-backed pagination.
- Added exact database pagination plus search/due filters for callbacks, cursor navigation through agent contact source pages, and user-friendly blocked-call messaging. Removed the permanently blocked number-reveal control.
- Added an expandable admin-sidebar roster using official `GET /users/search` with company/location scope and pagination. Admin/owner and unclear-role records are excluded. Assignment options and server-side PATCH validation now require both an active Terraverse agent profile and an explicitly verified GHL non-admin user.
- Added `GHL_COMPANY_ID` to the environment template, Settings status, and handover docs. `.env.local` was not read or modified.

### Files changed
- `src/components/ui.tsx`, `src/components/ui.module.css`, `src/components/workspace-shell.tsx`, `src/components/workspace-shell.module.css`, `src/components/admin-agent-roster.tsx`, `src/app/globals.css` — shared design primitives, shell, and admin roster.
- `src/app/dashboard/page.tsx`, `src/app/dashboard/page.module.css`, `src/app/contacts/page.tsx`, `src/app/contacts/contacts-manager.tsx`, `src/app/contacts/contacts-manager.module.css`, `src/app/contacts/[id]/page.tsx`, `src/app/contacts/[id]/actions.ts`, `src/app/contacts/[id]/contact-profile.module.css`, `src/app/api/admin/contacts/route.ts`, `src/lib/contact-history.ts` — admin metrics, contact data/history, pagination, and assignment.
- `src/app/calls/page.tsx`, `src/app/calls/[id]/page.tsx`, `src/app/calls/calls.module.css`, `src/app/callbacks/page.tsx`, `src/app/callbacks/callback-list.tsx`, `src/app/callbacks/callback-list.module.css`, `src/app/open-queue/page.tsx`, `src/app/open-queue/agent-contact-list.tsx`, `src/app/open-queue/agent-contact-list.module.css` — call detail, callback workflow/pagination, and agent queue navigation.
- `src/lib/env.ts`, `src/lib/ghl.ts`, `src/lib/ghl-contact-data.ts`, `src/lib/ghl-contact-data.test.ts`, `src/lib/ghl-user-data.ts`, `src/lib/ghl-user-data.test.ts`, `src/lib/assignable-agents.ts`, `src/app/api/admin/agents/route.ts`, `src/app/settings/page.tsx`, `src/app/settings/settings-console.tsx`, `src/app/settings/settings.module.css`, `.env.example`, `docs/INTEGRATION_REQUIREMENTS.md`, `docs/DEPLOYMENT_HANDOVER.md`, `memory.md` — GHL user parsing, role checks, configuration, and verification notes.

### Verification
- `npm test` — PASS (4 files, 19 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS; `/api/admin/agents` and `/calls/[id]` compile alongside existing routes.
- Static editor diagnostics — no errors in touched TypeScript files.
- Live GHL roster/assignment call was not run; no customer records were modified.

### Decisions and assumptions
- Official docs confirm `GET /users/search`, required `companyId`, `locationId`, `skip`, `limit`, and response `users`/`count`; `GET /users/:userId` provides a `roles` object. Nested role variants still require confirmation against the actual location response.
- The roster shows only records with a known non-admin role. Assignment additionally requires an active `profiles.app_role = agent` mapping and rechecks the GHL user role server-side; unmapped users are visible as needing access but are not assignable.
- GHL users are paged up to 500 records; the UI reports when the roster is capped. The agent side does not receive this roster.

### Blockers / owner input needed
- Set non-secret `GHL_COMPANY_ID` in `.env.local` or the deployment environment, then restart the app. The existing private integration must have `users.readonly`.
- Verify the live Search Users/Get User payload exposes a supported role field; records with unrecognized roles remain hidden and unassignable.
- Provision/map desired GHL users as active Terraverse `agent` profiles before assigning contacts to them.

### Next step
- Configure `GHL_COMPANY_ID`, sign in as admin, confirm the sidebar excludes admins and marks mapped users Ready, then assign one approved test contact and verify it appears only in that mapped agent's Open queue.

## Previous checkpoint
- Date: 2026-10-09
- Time: 22:52:04 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 20 — GHL status custom-field key parsing and editable status
- Status: COMPLETE LOCALLY; LIVE GHL STATUS RESPONSE STILL NEEDS RUNTIME CONFIRMATION

### Completed
- Updated contact normalization to read status by the configured GHL custom-field key (`{{contact.status}}`) as well as the resolved field ID, including `value` and `fieldValue` payload variants.
- Added metadata resolution for common GHL custom-field response shapes and key properties. It supports a unique `Status` name fallback when metadata omits a key, and rejects ambiguous matches.
- Passed the configured field key through GHL list and detail parsing; preserved fail-closed status semantics (missing status is Unknown and never Open).
- Changed admin bulk status editing to a validated single-line text input; status writes resolve the actual GHL field ID and send the update to GHL. Status options are no longer limited to Open.
- Removed the obsolete status-value allow-list requirement from the environment template and settings UI.

### Files changed
- `src/lib/ghl-contact-data.ts` — custom-field key matching, status normalization, and GHL metadata key resolver.
- `src/lib/ghl-contact-data.test.ts` — key-only payload, Liquid key normalization, metadata resolution, unique-name fallback, and ambiguous-field tests.
- `src/lib/ghl.ts` — repaired adapter and wired key-based field resolution into reads and writes.
- `src/lib/env.ts`, `src/app/api/admin/contacts/route.ts`, `src/app/contacts/contacts-manager.tsx`, `src/app/contacts/page.tsx`, `src/app/settings/page.tsx`, `src/app/settings/settings-console.tsx`, `.env.example` — editable status behavior and removed status allow-list dependency.
- `memory.md` — checkpoint record.

### Verification
- `npx vitest run src/lib/ghl-contact-data.test.ts` — PASS (8 tests).
- `npm test` — PASS (3 files, 15 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS; GHL contacts, admin API, and agent queue routes compile.
- Live GHL metadata/contact read was not run in this validation.

### Decisions and assumptions
- `{{contact.status}}` is normalized to `contact.status`; GHL’s update API still receives the resolved field ID from metadata.
- Status is a plain-text field, so admin-entered values are accepted up to 80 characters. The agent queue treats only the configured Open value as open.
- A unique metadata display name `Status` can be used only if exact key metadata is missing; duplicate matches remain blocked.
- `.env.local` was not read or changed.

### Blockers / owner input needed
- Restart the local Next.js dev server so the updated code and existing `GHL_CONTACT_STATUS_FIELD_KEY={{contact.status}}` environment setting are loaded.
- Refresh `/contacts`. If status still says Unknown, use the admin connection/status diagnostic and check the GHL custom-fields metadata response shape; no secret or contact data should be shared.

### Next step
- Restart the dev server, refresh Contacts, confirm actual GHL status values display, then select a test contact and change status to verify the update persists in GHL before bulk editing production contacts.

## Latest checkpoint
- Date: 2026-10-09
- Time: 22:32:24 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 19 — Simplified GHL Private Integration configuration
- Status: COMPLETE LOCALLY; LIVE GHL REQUEST NOT RUN

### Completed
- Reduced active GHL contact configuration to the Private Integration key and location ID; the standard LeadConnector API host is now internal to the adapter.
- Removed unused OAuth mode/client credentials and account ID from runtime config, `.env.example`, deployment checklist, settings status, and connection-test requirements.
- Preserved GHL webhook secret because the webhook route validates signed webhooks; preserved status field ID and allowed/Open status values because admin status edits depend on them.
- Hydrated the initial admin contacts page on the server instead of relying on the client effect; corrected the agent queue fallback pagination shape.
- Did not open or modify `.env.local`; its private key and any stale unused lines remain private/local.

### Files changed
- `src/lib/env.ts`, `src/lib/ghl.ts`, `src/lib/dispositions.ts` — minimal GHL configuration and fixed default API host.
- `src/app/settings/page.tsx`, `src/app/settings/settings-console.tsx`, `src/app/api/admin/integrations/check/route.ts`, `src/app/dashboard/page.tsx` — reflect key + location requirements.
- `src/app/contacts/page.tsx`, `src/app/contacts/contacts-manager.tsx`, `src/app/open-queue/page.tsx` — server hydration and type-safe queue fallback.
- `.env.example`, `docs/DEPLOYMENT_HANDOVER.md` — remove unused GHL OAuth/account/base URL settings.
- `memory.md` — checkpoint record.

### Verification
- `npm run lint` — PASS.
- `npm test` — PASS (3 files, 11 tests).
- `npm run build` — PASS; `/contacts`, `/api/admin/contacts`, and `/open-queue` compile.
- Live GHL contact fetch was not run from this session.

### Decisions and assumptions
- Contact fetching uses `GHL_PRIVATE_INTEGRATION_KEY` and `GHL_LOCATION_ID`; API base remains the documented LeadConnector URL in code.
- Status mutation still requires `GHL_CONTACT_STATUS_FIELD_ID` plus allowed/Open values.
- `GHL_WEBHOOK_SECRET` is retained only for signed webhook validation.
- Extra old lines in `.env.local` are ignored by the app once their readers are removed; they were not edited to avoid reading or rewriting secret-bearing content.

### Blockers / owner input needed
- Verify the Private Integration key has `contacts.readonly`, `contacts.write`, `locations/customFields.readonly`, and `users.readonly` as needed by the enabled features.
- Configure the actual location ID and contact status custom-field ID/options before using contact status updates.
- Remove the obsolete local lines `GHL_AUTH_MODE`, `GHL_API_BASE_URL`, `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, and `GHL_ACCOUNT_ID` from `.env.local` if desired; do not share their values.

### Next step
- Restart the dev server so the simplified environment model is loaded, sign in as admin, open `/contacts`, and test the GHL contact read before attempting status/assignment mutations.

## Latest checkpoint
- Date: 2026-10-09
- Time: 20:44:51 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 18 — OTP login failure handling and token-length compatibility
- Status: COMPLETE LOCALLY; LIVE SUPABASE EMAIL CONFIGURATION STILL REQUIRES OWNER VERIFICATION

### Completed
- Removed the hard-coded six-digit server validation and six-character input cap. Numeric codes up to 32 characters now reach Supabase, which remains authoritative for the configured OTP length.
- Fixed the OTP request action falsely reporting success when Supabase returns an error. It now keeps the user on email entry and gives safe setup/rate-limit guidance.
- Added separate safe messages for OTP throttling, expiration, invalid/rejected codes, Supabase unavailability, and profile authorization lookup failures. Logs record only non-secret status/code metadata, not email, token, or raw error content.
- Added focused OTP helper tests covering variable-length numeric codes, preserved leading zeroes, safe provider error handling, expiry classification, and throttling.

### Files changed
- `src/lib/otp.ts` — OTP normalization/validation and safe error categorization.
- `src/lib/otp.test.ts` — focused OTP behavior tests.
- `src/app/login/actions.ts` — truthful send result and resilient verification/profile error handling.
- `src/app/login/page.tsx` — allow configured OTP lengths without a six-digit maximum.
- `memory.md` — recorded this repair checkpoint.

### Verification
- `npx vitest run src/lib/otp.test.ts` — PASS (4 tests).
- `npm test` — PASS (2 files, 7 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS; all routes compiled.
- Live OTP delivery/verification was not exercised because it requires a real Supabase email and configured Auth provider.

### Decisions and assumptions
- Supabase Dashboard Email OTP length is authoritative; local code should not guess it or truncate codes.
- A successful Supabase OTP request does not guarantee inbox delivery; delivery still depends on Auth email settings, SMTP/template, and the registered user.
- User-facing errors intentionally avoid leaking account existence or raw provider diagnostics.

### Blockers / owner input needed
- Confirm Supabase Auth Email OTP is enabled and its email template contains the numeric token (`{{ .Token }}`).
- Confirm the emailed token length matches the Supabase Email OTP configuration and use only the newest email's code.
- Inspect Supabase Auth logs/server terminal diagnostics if a new code is still rejected; do not share OTPs or secrets.

### Next step
- Retest by requesting one fresh code, entering all digits from that latest email for the same address, and report the new on-screen message if it fails. Use Supabase Auth logs to identify delivery/token configuration errors without exposing credentials.

## Latest checkpoint
- Date: 2026-10-09
- Time: 19:25:40 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 17 — Supabase authentication, role authorization, RLS hardening, and demo-data removal
- Status: COMPLETE LOCALLY; REMOTE SUPABASE SETUP PENDING

### Completed
- Replaced the hard-coded demo registry and deterministic OTP fallback with Supabase email OTP. Responses do not reveal whether an email is provisioned, signup is disabled, and OTP requests/verification attempts are rate-limited.
- Added Supabase SSR cookie handling and request-time token refresh. Every protected request validates Supabase Auth and the active `profiles` row; role and GHL mapping are not read from a client-controlled session cookie.
- Added admin/agent routing and API protection, secure browser response headers, and a follow-up migration that avoids recursive role policies and removes direct browser writes to operational/audit tables.
- Removed fake customer, call, callback, and session records and the SQL fixture seeder. Dashboard, callback, and session pages now read authorized Supabase records or show explicit empty/unavailable states.
- Added `.env.example` Supabase publishable-key naming and `docs/SUPABASE_SETUP.md` with migration commands, OTP configuration, and owner-controlled user/profile provisioning.
- Existing `.env.local` was not edited. A local Supabase JWT signing secret was inadvertently emitted during an environment-name search; rotate the Supabase signing secret/key immediately and remove the obsolete local `SUPABASE_JWT_SECRET` and `SESSION_SECRET` entries because this app does not use them.

### Files changed
- `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/supabase-server.ts` — Supabase identity types, SSR client, and active profile session lookup.
- `src/app/login/actions.ts`, `src/app/login/page.tsx`, `src/app/dashboard/actions.ts`, `proxy.ts` — OTP login, logout, token refresh, and route/API authorization.
- `supabase/migrations/20261009_000002_lock_down_rls.sql` — non-recursive active-role helpers and restricted read-only RLS policies.
- `src/app/page.tsx`, `src/app/dashboard/page.tsx`, `src/app/callbacks/page.tsx`, `src/app/sessions/page.tsx`, `src/app/dispositions/page.tsx`, related CSS, and `src/lib/callbacks.ts` — removed sample data and replaced it with persisted data/empty states.
- `supabase/tests/fixtures.sql` — removed fake user/contact/session/call/callback fixture inserts.
- `.env.example`, `docs/SUPABASE_SETUP.md`, `next.config.ts`, `package.json`, `package-lock.json` — setup guide/template, security headers, Supabase SSR dependency.
- `memory.md` — this checkpoint.

### Verification
- `npm test` — PASS (1 test file, 3 tests).
- `npm run lint` — PASS.
- `npm run build` — PASS; all routes compiled.
- Supabase migrations were not run against a remote project because project authorization was not available in this workspace.
- Manual login and role checks remain pending until the owner applies migrations, configures email OTP, and provisions actual auth users/profile rows.

### Decisions and assumptions
- Role is granted only through owner-managed `profiles.app_role`; there is no public signup or self-service admin creation.
- GHL user mapping is nullable until verified. Agent queue reads fail closed if it is missing.
- Provider calling, webhook persistence, and live GHL reads remain blocked/unverified; adding credentials alone does not establish a verified integration.
- Existing `.env.local` values were treated as private and left unchanged. Do not record or share secrets in this log.

### Blockers / owner input needed
- Rotate the Supabase JWT signing key/secret because it was accidentally included in a local command result; re-authentication may be required afterward.
- Set/confirm `NEXT_PUBLIC_SUPABASE_URL` and either `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or the supported legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`.
- Apply migrations to the intended development Supabase project and configure numeric email OTP delivery.
- Create actual Supabase Auth users and provision one admin plus test agents in `public.profiles` using the setup guide.
- Verify GHL and Crazytel account contracts before enabling live operations.

### Next step
- Owner rotates the Supabase signing key, applies `npx supabase db push` to a development project, provisions admin/agent profiles, then manually verifies login, role routing, and agent-vs-admin RLS behavior before any live provider activation.

## Latest checkpoint
- Date: 2026-10-09
- Time: 15:31:16 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 16 — UI/UX polish and premium app shell experience
- Status: COMPLETE

### Completed
- Refreshed the entire light-theme app experience with a more premium, modern visual system across the shared shell, dashboards, and login flow.
- Reworked the global design tokens to use cleaner blue-toned surfaces, layered glassmorphism, softer shadows, richer spacing, and motion cues while preserving the existing fail-closed product logic.
- Added subtle animations and hover interactions for cards, buttons, panels, and decorative glows to make the system feel more polished without becoming noisy or distracting.
- Updated the login screen and core dashboard shell to maintain a consistent visual language and stronger UX hierarchy.

### Files changed
- `src/app/globals.css` — updated global theme tokens, gradients, motion, and polish rules.
- `src/app/page.module.css` — modernized the main dashboard shell, sidebar, cards, and action controls.
- `src/app/login/page.module.css` — improved the login form, panel treatment, and success/error states.
- `memory.md` — recorded the Stage 16 UI/UX verification summary.

### Verification
- Command: `npm run build` — result: PASS.
- Production build output confirms the refreshed UI compiles successfully and remains compatible with the safe app shell and routes.

### Decisions and assumptions
- The visual changes are purely frontend polish and do not alter the fail-closed provider behavior or production safety model.
- The design is intentionally clean and premium rather than highly heavy or cartoonish, keeping the app professional for a calling operation workflow.

### Blockers / owner input needed
- None for this UI pass.

### Next step
- Continue to any real provider verification or deeper product refinement once the owner confirms the live integration path and brand direction.

## Latest checkpoint
- Date: 2026-10-09
- Time: 15:34:18 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 15 — Deployment readiness and handover documentation
- Status: COMPLETE

### Completed
- Added the deployment and handover guide at `docs/DEPLOYMENT_HANDOVER.md` covering environment variables, Supabase migration workflow, provider readiness, deployment steps, rollback plan, and known limitations.
- Kept the handover documentation honest and fail-closed: it reflects what has been verified locally and explicitly labels the remaining provider-side blockers.

### Files changed
- `docs/DEPLOYMENT_HANDOVER.md` — deployment checklist, cutoff gates, and operational guidance.
- `memory.md` — updated with the Stage 15 handover verification record.

### Verification
- Command: `npm test` — result: PASS.
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms the app remains in a verified local-safe state after the final handover documentation update.

### Decisions and assumptions
- The handover guide is a living operational checklist and not a claim of production connectivity.
- The app is ready for further local or staging work, but real GHL/Crazytel production activation still depends on owner-side account verification.
- Rollback and secret handling remain server-side and should follow the platform’s secret manager model.

### Blockers / owner input needed
- Final production account verification for GHL and Crazytel
- Approved test-call plan and webhook registration for the live environment
- Owner permission to move from staged mode to production-connected mode

### Next step
- Deploy only after the live account configuration and approved production test plan are confirmed by the owner or platform admin.

## Latest checkpoint
- Date: 2026-10-09
- Time: 15:30:17 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 14 — Hardening and security-focused test coverage
- Status: COMPLETE

### Completed
- Added a reusable in-memory rate limiter in `src/lib/rate-limit.ts` to enforce request thresholds and prevent repeated abuse attempts across the app surface.
- Added a red-to-green test suite in `src/lib/rate-limit.test.ts` covering allowance, threshold blocking, and time-window expiry behavior.
- Added a project test script in `package.json` so the security checks can be run consistently during review.

### Files changed
- `src/lib/rate-limit.ts` — generic request throttling helper with key-based tracking and expiry handling.
- `src/lib/rate-limit.test.ts` — hardening checks for request limiting and expiry behavior.
- `package.json` — `test` script for automated verification.
- `memory.md` — recorded the Stage 14 verification result and next guardrail step.

### Verification
- Command: `npx vitest run src/lib/rate-limit.test.ts` — result: PASS.
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms the app remains build-safe after the hardening layer and test coverage were added.

### Decisions and assumptions
- The requested rate-limiter is intentionally local/in-memory and should be replaced with a server-side/shared store in production for multi-instance deployments.
- The stage adds the critical abuse-control guardrail while leaving provider-specific webhook and real-account integration tests intentionally blocked until the account-side contract is verified.
- The application is still fail-closed on live CRM/telephony behavior and does not claim real external integration success without evidence.

### Blockers / owner input needed
- Shared-rate-limit storage requirements for multi-server deployments
- Verified GHL/Crazytel webhook payload contract for end-to-end spoofing tests
- Real test credentials and environment for live auth, session, and provider replay checks

### Next step
- Proceed to the next stage only after real account-side verification is available for the live webhook and provider integration hardening tests.

## Latest checkpoint
- Date: 2026-10-09
- Time: 15:24:01 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 13 — Manager reporting dashboard and operations summary view
- Status: COMPLETE

### Completed
- Expanded the protected dashboard into a manager-style operations overview with KPI cards, productivity bars, integration health checks, recent-call table, and event feed.
- Kept the reporting layer intentionally static and safe, using mock data until the verified provider metrics and audit source are available.
- Added the dashboard presentation layer in `src/app/dashboard/page.tsx` and `src/app/dashboard/page.module.css` without claiming live provider analytics.

### Files changed
- `src/app/dashboard/page.tsx` — manager dashboard with operational summary cards, team metrics, call history, and audit feed.
- `src/app/dashboard/page.module.css` — layout and styling for the reporting dashboard shell and cards.
- `memory.md` — updated with the Stage 13 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms the protected dashboard route compiles successfully and exposes the reporting shell as a safe local dashboard view.

### Decisions and assumptions
- The manager dashboard is a UI layer for reporting and visibility, not a claimed live analytics system.
- Real metrics should be computed from trusted provider events and server-side records once the actual GHL/Crazytel contracts are verified.
- Integration health shows known state transitions without assuming provider connectivity.

### Blockers / owner input needed
- Source of truth for live call metrics and productivity calculations
- Real provider event mapping for dashboards and KPIs
- The exact review workflow for admin audit and approval actions

### Next step
- Proceed to the next stage only after the reporting source-of-truth and audit workflow are confirmed by the operator or project admin.

## Latest checkpoint
- Date: 2026-10-09
- Time: 15:17:59 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 12 — Callback queue, due/overdue handling, and in-app notification flow
- Status: COMPLETE

### Completed
- Added `src/lib/callbacks.ts` with typed callback tasks, due/overdue status calculations, and helper summaries for next-due and notification counts.
- Added a protected callback queue page at `src/app/callbacks/page.tsx` with assigned follow-up tasks, timezone-aware due labels, and a demo-safe notification banner.
- Added local styling in `src/app/callbacks/page.module.css` for the callback list, due state badges, and summary cards.

### Files changed
- `src/lib/callbacks.ts` — callback lifecycle status and queue summary modeling.
- `src/app/callbacks/page.tsx` — callback workflow view with safe in-app notifications and assigned task list.
- `src/app/callbacks/page.module.css` — callback dashboard styling.
- `memory.md` — updated with the Stage 12 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms the new `/callbacks` route compiles successfully and the callback flow remains a safe local workflow until the provider-side scheduling contract is verified.

### Decisions and assumptions
- The callback queue is intentionally local and auditable without claiming live GHL or Crazytel synchronization.
- Due/overdue logic is a workflow model for the app shell, not a production provider event source until the owner confirms the final source of truth for callback state.
- Notification delivery remains a presentation layer until a verified service-worker or provider integration is configured.

### Blockers / owner input needed
- Exact callback source-of-truth once external provider sync is enabled
- Timezone handling and due-date policy for multi-agent and multi-region operations
- Whether push or in-app notifications are required for live production work

### Next step
- Proceed to the next stage only after the callback source-of-truth, timezone rules, and notification policy are validated by the owning operator or project admin.

## Latest checkpoint
- Date: 2026-10-09
- Time: 15:32:18 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 10 — Call dispositions, qualification, and GHL sync guardrails
- Status: COMPLETE

### Completed
- Added a typed disposition sync module in `src/lib/dispositions.ts` that normalizes outcomes and blocks CRM sync until the live GHL account contract is validated.
- Added a protected POST route at `src/app/api/dispositions/route.ts` that enforces authenticated access and rejects sync attempts until provider verification is complete.
- Added a lightweight disposition form at `src/app/dispositions/page.tsx` to demonstrate the workflow in a safe, blocked-by-design way without pretending live CRM write operations are active.

### Files changed
- `src/lib/dispositions.ts` — outcome normalization and fail-closed GHL sync logic.
- `src/app/api/dispositions/route.ts` — authenticated disposition endpoint with validation and blocked response behavior.
- `src/app/dispositions/page.tsx` — client view for submitting dispositions without claiming live sync success.
- `src/app/dispositions/page.module.css` — presentation styling for the staged disposition form.
- `memory.md` — updated with the Stage 10 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms the disposition API and form route compile successfully and remain safe until the real GHL write contract is available.

### Decisions and assumptions
- The disposition flow is intentionally fail-closed and not treated as a live CRM write.
- Actual sync to GHL, callback scheduling, and note persistence remain blocked pending verified account-side metadata and endpoint access.
- This stage establishes the API contract and safety boundaries without claiming production write support.

### Blockers / owner input needed
- Verified GHL note/create or update endpoint and field mapping
- Real callback timezone policy and canonical disposition values
- The actual permissions and contact-write contract for the live CRM account

### Next step
- Proceed to Stage 11 only after the real GHL disposition/write contract and callback policy are confirmed from the owning account or provider admin.

## Latest checkpoint
- Date: 2026-10-09
- Time: 15:17:59 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 11 — Session tracking, idle detection, and pause logic
- Status: COMPLETE

### Completed
- Added `src/lib/work-sessions.ts` with a typed work session state model, idle timeout threshold, pause evaluation, and safe end-of-session lifecycle handling.
- Added a session monitoring page at `src/app/sessions/page.tsx` and `src/app/sessions/page.module.css` to demonstrate the active, paused, and ended states in a local app-safe way.
- Implemented a realistic idle policy that pauses the session after 60 seconds of no qualifying activity while preserving active-call exemptions.

### Files changed
- `src/lib/work-sessions.ts` — session state, idle evaluation, and safe lifecycle helpers.
- `src/app/sessions/page.tsx` — session status dashboard and policy controls.
- `src/app/sessions/page.module.css` — light-theme styling for the work session view.
- `memory.md` — updated with the Stage 11 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms the new `/sessions` route compiles successfully and the app remains build-safe with the idle enforcement scaffold in place.

### Decisions and assumptions
- The work-session model is intentionally local and auditable without connecting to a live workforce platform or provider-side state service.
- Idle detection remains an app-level workflow rule rather than a production supervision signal until owner-side monitoring requirements are confirmed.
- The session state is fail-safe: it can pause or end a session without claiming live call-center automation.

### Blockers / owner input needed
- Whether the workflow requires a real back-end session store and supervisor audit trail
- Whether call activity should be derived from Crazytel events, GHL call metadata, or a separate internal signal
- Whether the 60-second threshold should be configurable per agent or team

### Next step
- Proceed to the next stage only after the session policy and audit requirements are validated by the owning operator or project admin.

## Previous checkpoint
- Date: 2026-10-09
- Time: 15:25:14 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 9 — Webhooks, event validation, and idempotent processing guardrails
- Status: COMPLETE

### Completed
- Added raw-body webhook validation helpers in `src/lib/webhooks.ts` for HMAC signature checks, payload normalization, and blocked-state responses.
- Added provider webhook route handlers at `src/app/api/webhooks/ghl/route.ts` and `src/app/api/webhooks/crazytel/route.ts` that reject malformed or unsigned traffic and return a clear blocked status when provider secrets are not yet configured.
- Kept the webhook lifecycle explicit and fail-closed: accepted traffic is only treated as a receipt, not as a live production processing success, until provider verification is complete.

### Files changed
- `src/lib/webhooks.ts` — raw-body verification, signature comparison, event id normalization, blocked-state helper.
- `src/app/api/webhooks/ghl/route.ts` — GHL webhook route with signed-payload validation and safe rejection logic.
- `src/app/api/webhooks/crazytel/route.ts` — Crazytel webhook route with signed-payload validation and safe rejection logic.
- `memory.md` — updated with the Stage 9 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms the webhook routes compile and are exposed as dynamic server routes without claiming live provider processing.

### Decisions and assumptions
- Webhook handling remains intentionally safe until the real provider secrets and event contract are verified.
- The app does not treat webhook acceptance as a completed production integration; it only proves the route exists and can reject malformed/unauthorized traffic properly.
- Real persistence, idempotency storage, and recording access remain blocked pending provider account verification.

### Blockers / owner input needed
- Verified GHL webhook secret and event payload contract
- Verified Crazytel webhook secret and event payload contract
- Whether recordings are enabled and how they are accessed securely
- The actual provider usage pattern for unique event IDs and replay handling

### Next step
- Proceed to Stage 10 only after the real provider event contracts and recording/access rules are confirmed by the account owner or provider admin.

## Previous checkpoint
- Date: 2026-10-09
- Time: 15:17:48 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 8 — Crazytel adapter and call lifecycle guardrails
- Status: COMPLETE

### Completed
- Added `src/lib/crazytel.ts` with a typed Crazytel adapter skeleton, validation guard, and fail-closed call creation logic.
- Implemented explicit lifecycle state mapping for requested/ringing/answered/completed/failed/cancelled events so the app can safely normalize provider webhook events once the real account method is verified.
- Preserved the rule that no live call initiation or event processing is treated as complete without verified Crazytel account configuration, auth method, webhook secret, outbound caller ID, and test destination.

### Files changed
- `src/lib/crazytel.ts` — provider config validation, safe call initiation result, and lifecycle-state normalization.
- `memory.md` — updated with the Stage 8 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms the app builds successfully with the Crazytel adapter scaffold in place.

### Decisions and assumptions
- The Crazytel adapter is intentionally non-productive until the real account method is confirmed.
- The adapter uses fail-closed behavior rather than an invented API contract.
- Real call initiation, recording events, and webhook processing remain blocked pending provider-side evidence.

### Blockers / owner input needed
- Exact Crazytel account method (SIP, WebRTC, server API, or another flow)
- Verified outbound caller ID and test destination
- Provider webhook payload/event list and signature method
- Whether recordings are enabled and what access controls apply

### Next step
- Proceed to Stage 9 only after the Crazytel account method and webhook contract are validated by the provider admin or account owner.

## Previous checkpoint
- Date: 2026-10-09
- Time: 15:11:28 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 7 — Contact detail and privacy-preserving call initiation
- Status: COMPLETE

### Completed
- Added a secure contact detail route at `src/app/contacts/[id]/page.tsx` that enforces session access and displays only masked phone data for the current assigned agent.
- Added the reveal and call initiation actions in `src/app/contacts/[id]/actions.ts` as server-side routes that intentionally fail closed until real GHL/Crazytel auth and account configuration is verified.
- Added light-theme contact detail styling in `src/app/contacts/[id]/page.module.css` and a contact-link path from the queue page to the single-contact workflow.
- Kept the implementation privacy-first: no full phone number is exposed to the browser, and no live call initiation is allowed without verified provider setup.

### Files changed
- `src/app/contacts/[id]/page.tsx` — masked contact detail view and blocked-state messaging.
- `src/app/contacts/[id]/actions.ts` — reveal/call actions that redirect to a safe blocked state when provider verification is missing.
- `src/app/contacts/[id]/page.module.css` — contact detail styling.
- `src/app/open-queue/page.tsx` — queue row links to the single-contact detail route.
- `memory.md` — updated with the Stage 7 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms `/contacts/[id]` is a dynamic server-rendered route and the app remains build-safe with the privacy-preserving detail flow in place.

### Decisions and assumptions
- The workflow intentionally prevents full number reveal and outbound call initiation until required provider setup is verified.
- This is a fail-closed model, not a live provider integration claim.
- Browser masking alone is not treated as security; all critical actions remain server-authoritative and blocked by design in unverified environments.

### Blockers / owner input needed
- GHL account verification remains required for any real number reveal and contact read flow.
- Crazytel account verification remains required before any real outbound call can be initiated.

### Next step
- Proceed to Stage 8 only after the actual Crazytel account method and GHL contact contract are confirmed by the account owner or provider admin.

## Previous checkpoint
- Date: 2026-10-09
- Time: 15:18:17 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 6 — GHL read integration and contact queue guardrails
- Status: COMPLETE

### Completed
- Added a typed GHL adapter interface in `src/lib/ghl.ts` for contact reads, pagination metadata, retry handling, and provider verification gates.
- Added an authenticated server-side open-queue page at `src/app/open-queue/page.tsx` that enforces session access and blocks live contact reads until a verified GHL account configuration exists.
- Added a queue UI styled for the light-theme operations workflow and designed to clearly announce when provider verification is still required.
- Kept the implementation deliberately safe: no live GHL network request is executed unless the account is configured with non-placeholder credentials and verified endpoint metadata.

### Files changed
- `src/lib/ghl.ts` — typed GHL read adapter, retry helper, normalized contact type, and blocked-state guard.
- `src/app/open-queue/page.tsx` — secured open-queue route with session enforcement and safe queue rendering.
- `src/app/open-queue/page.module.css` — light-theme queue styling and blocked-state UI.
- `memory.md` — updated with the Stage 6 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms `/open-queue` is a dynamic server-rendered route and the app remains buildable with the staged GHL guardrails in place.

### Decisions and assumptions
- No live GHL contact reading is attempted without verified account configuration and a documented endpoint contract.
- The queue behavior is deliberately blocked until the real GHL account is validated; this prevents false success claims and enforces a safe fail-closed pattern.
- The app remains in a demo-safe mode for contact listing while the actual account fields and Open-status semantics are still pending verification.

### Blockers / owner input needed
- Exact GHL account auth method, contact assignment semantics, Open-state source, and contact field metadata remain required before any real GHL contact list can be consumed.
- Crazytel verification remains a separate blocker for downstream call initiation, but it is not required for the read-only queue scaffold stage.

### Next step
- Proceed to Stage 7: contact detail and privacy-preserving call initiation, but only after the GHL account contract and the real Open-status semantics are confirmed by the owning account or admin.

## Previous checkpoint
- Date: 2026-10-09
- Time: 15:06:50 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 5 — Auth flow, secure session guard, and dashboard access control
- Status: COMPLETE

### Completed
- Added a protected dashboard route with server-side authentication enforcement via an HTTP-only session cookie.
- Implemented session creation, validation, and logout helpers for approved users.
- Added login server actions for OTP request and verification with a local demo approval fallback for development-only access.
- Created the login page and authenticated dashboard shell with a light-theme layout and secure UX feedback.
- Fixed the production build issue caused by route prerendering conflicts by making the protected dashboard dynamic and removing incompatible experimental cache settings from `next.config.ts`.

### Files changed
- `src/app/dashboard/page.tsx` — protected dashboard render gate and session-based access enforcement.
- `src/app/dashboard/page.module.css` — logout button and header styling for the session-protected shell.
- `src/app/dashboard/actions.ts` — secure logout action.
- `src/app/login/page.tsx` — OTP email form and local demo login UI.
- `src/app/login/actions.ts` — OTP request/verification server actions.
- `src/lib/auth.ts` — approved-user registry, OTP generation, and demo-safeguarded auth scaffolding.
- `src/lib/session.ts` — HTTP-only session create/get/clear implementation.
- `next.config.ts` — reverted experimental cache settings to allow dynamic route rendering.
- `memory.md` — updated with the Stage 5 completion record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- Production build output confirms: `/dashboard` is a dynamic server-rendered route and `/login` remains available as a static page.

### Decisions and assumptions
- The app is now locally authenticated in a demo-safe mode, not yet connected to a live Supabase auth provider or a production GHL/Crazytel account.
- The session is intentionally server-side only and does not expose user data or tokens to the client.
- All provider integrations remain intentionally unverified and are not claimed as complete until account-side evidence is supplied.

### Blockers / owner input needed
- No blocker for the local auth scaffold itself.
- Real GHL and Crazytel verification remains the next required external prerequisite before live provider identities, call actions, or webhook logic can be implemented safely.

### Next step
- Proceed to Stage 6 only after the owner confirms the real GHL and Crazytel account configuration, or keep using the current demo-safe scaffold for local app development while preserving the verified blocker as a constraint.

## Previous checkpoint
- Date: 2026-10-09
- Time: 15:02:27 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 4 — Supabase schema, RLS, and test fixtures
- Status: COMPLETE

### Completed
- Added a versioned Supabase migration file for the required core tables and indexes: `profiles`, `contacts_cache`, `work_sessions`, `activity_logs`, `calls`, `call_dispositions`, `callbacks`, `webhook_events`, and `audit_logs`.
- Added explicit RLS policies for admin-only and agent-scoped access boundaries, including role protection for `profiles` and agent-level restrictions on assigned contact and call data.
- Added a safe fixture script for local development use without customer data.
- Added a SQL-based RLS validation checklist covering expected denied-access behavior and admin/agent boundary checks.

### Files changed
- `supabase/migrations/20261009_000001_init_schema.sql` — initial schema, enums, indexes, triggers, and row-level security policies.
- `supabase/tests/fixtures.sql` — local-only test data for admin and agent scenarios.
- `supabase/tests/rls_policy_checks.sql` — SQL checks for admin-vs-agent access boundaries and role-escalation protections.
- `memory.md` — updated with the Stage 4 verification record.

### Verification
- Command: `npm run lint` — result: PASS.
- Command: `npm run build` — result: PASS.
- SQL validation: not executed against a live Supabase database in this workspace; the migration and policy files were prepared for deployment to a Supabase project and should be applied there with the normal migration tooling.

### Decisions and assumptions
- All provider integrations remain intentionally unverified and are not considered complete.
- Service-role access remains server-only by design; the migration relies on Supabase RLS and auth context rather than client-side exposure.
- The schema is a secure foundation for later stages, but it is still a blank data model until real production credentials and account metadata are confirmed.

### Blockers / owner input needed
- No blockers for the schema foundation itself.
- The next required verification remains the account-specific GHL and Crazytel configuration required by Stage 2, before any production integration logic or live data mapping is attempted.

### Next step
- Proceed to Stage 5: authentication and GHL identity mapping, using the new schema as the persistence layer while keeping all external account wiring behind explicit verified configuration.

## Previous checkpoint
- Date: 2026-10-09
- Time: 15:00:05 Pakistan Standard Time (UTC+05:00)
- Stage: Stage 3 — Design system and responsive app shell
- Status: COMPLETE
- Summary: Replaced the default starter page with a light-theme operations dashboard shell and verified the project still linted and built successfully.
