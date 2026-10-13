# Integration Requirements — Stage 2

## Objective
This document records the current state of verification for the GoHighLevel (GHL) and Crazytel integrations before any implementation work proceeds. It distinguishes between items that are confirmed by official documentation and items that remain blocked pending account-owner input or provider-side evidence.

## 1) GoHighLevel — confirmed from official developer documentation

The official GHL developer materials currently state that:

- GHL exposes both OAuth 2.0 and Private Integration authentication models.
- The public developer documentation presents an API reference and quick-start flow for integrating with HighLevel services.
- The Marketplace documentation includes a Quick Start Guide and an Authorization page, and the example request shows a Bearer token pattern using the Authorization header.
- The documented API surface includes CRM & Contacts, Messaging, Calendar, Sales/Opps, Payments, and Webhooks.
- The API examples and docs use the services.leadconnectorhq.com host pattern for API traffic, which is consistent with HighLevel’s hosted API surface.

This is enough to confirm the general integration model is token-based and the platform supports the broad product areas we need for CRM/contact access and webhook-driven updates.

### GHL status summary
- Auth method: Confirmed at a high level as OAuth 2.0 and/or Private Integration tokens.
- Contact and CRM APIs: Confirmed at a category level in official docs.
- Webhook support: Confirmed in documentation as a supported capability.
- Exact endpoint contract: Not yet confirmed for the specific account configuration in this project.

## 2) GoHighLevel — still blocked or unverified

The following account-specific details are not yet confirmed by the official docs available in this environment and must be verified against the actual GHL account before implementation proceeds:

1. Whether the real account uses a private integration token or OAuth 2.0.
2. Exact user lookup/list/search endpoints and response schema for the customer account.
3. Exact contact list/search/filter semantics and pagination requirements.
4. The real meaning of the contact Open state in this account. It may be a custom field, tag, pipeline stage, or status flag, and it must not be assumed.
5. The actual subject field name or fallback logic used by the organization.
6. Custom field IDs and metadata for current CRM objects.
7. The real assignment field used to map contacts to GHL user IDs.
8. Contact-note creation and retrieval endpoints and any supported idempotency details.
9. The exact webhook event payloads and signature verification method for contact assignment/status changes.
10. Rate limits, token refresh behavior, and required scopes for the actual integration type.

### Required owner/account-side evidence

Before implementing GHL logic, gather the exact evidence below from the owning account or admin:

- A screenshot or export showing the active authentication method and token setup.
- A sample contact payload showing the actual assigned-user, status, subject, and custom-field fields.
- A list of known GHL user IDs and their application roles.
- The exact webhook secret or verification header used by the connected GHL account.
- The account’s approved call/text workflow and the source of the Open status.

## 3) Crazytel — confirmed from official public materials

The official Crazytel website confirms that the company provides:

- Business SIP trunks
- Hybrid SIP trunks
- CrazyPBX cloud phone system
- Virtual mobile numbers and 1300/1800 numbers
- Softphone products and SMS gateway features
- A public-facing commercial product portfolio for Australian VoIP and telephony services

This confirms Crazytel is a valid VoIP provider in scope for a calling integration, but it does not confirm a publicly documented REST API contract for outbound call initiation, provider lifecycle events, or recordings in the set of URLs checked here.

## 4) Crazytel — blocked until account verification

The following critical implementation details remain unverified and cannot be safely assumed from the current public docs:

1. Whether the account supports browser WebRTC, SIP credentials, a server-side call control API, or another integration pattern.
2. The exact method used to initiate outbound calls and the required auth scheme.
3. Whether an Australian number can be used as the outbound caller ID under that account.
4. The webhook/event APIs for ringing, answered, completed, failed, busy, no-answer, duration, and recording events.
5. Whether call recordings are enabled on the account and how they are retrieved securely.
6. Whether the account uses webhook secrets, HMAC signatures, or another validation mechanism.
7. Any risk or policy constraints around emergency calls, concurrency, caller-ID verification, and usage caps.
8. Whether the app should use a server-authoritative provider adapter or a browser/client-side SIP flow.

### 4.1 Crazytel Hybrid WebRTC docs checked (2026-10-13)

Official Crazytel Hybrid SIP help confirms browser WebRTC is a Hybrid trunk feature that must be enabled; its WebRTC password is separate from the SIP password. The published client settings specify `wss://hybrid.sip.crazytel.net.au:8443`, a SIP identity of `sip:<trunk-username>@hybrid.sip.crazytel.net.au`, and TURN relay host `turn.crazytel.net` on UDP 3478 / TLS 5349. Hybrid supports signed HMAC-SHA256 call webhooks and has CDR/recording APIs.

Crazytel's official API docs identify `https://api.crazytel.io`, `X-Crazytel-Api-Key`, SIP trunk management, customer CDRs, and Hybrid recording endpoints. The API key is not WebRTC/SIP authentication and is not used to create the browser media call.

Still needs confirmation from the account owner/Crazytel support:

- The outbound PSTN SIP Request-URI accepted by this Hybrid trunk, including E.164/local number format. The app requires this in `CRAZYTEL_OUTBOUND_URI_TEMPLATE` and will not guess it.
- Whether TURN needs account credentials; the public WebRTC guide lists host/ports but not auth requirements.
- That the trunk caller ID is verified and is selected by Crazytel for WebRTC-originated outbound calls.
- The account-specific call/recording webhook signature header and event body; correlate using SIP Call-ID (`sip_call_id`), not recording `call_uuid`.
- Per-agent WebRTC credentials/trunks are preferred. A WebRTC secret delivered to the browser is visible to that signed-in agent; a single shared password is not secret from agents/devtools.

Implementation status: SIP.js can register over the documented WSS and make a WebRTC INVITE once the owner supplies credentials and confirms the outbound URI template. Calls save locally and associate the SIP Call-ID for active-call timer exemption. Until signed provider events/CDRs are verified and reconciled, call duration is agent-reported rather than provider-verified. No live call was placed during implementation.

### Required owner/account-side evidence

Before implementing the Crazytel adapter, obtain the following from the account owner or provider admin:

- The exact Crazytel product and plan enabled on the account.
- The configured outbound calling method (SIP, softphone, server API, or other).
- The verified outbound caller ID and any required account setup.
- A sample webhook payload or documentation showing the event names and auth method.
- Whether recording is enabled and any retention/access rules.
- Whether a test destination is approved for live call verification.

## 5) Stage 2 conclusion

This repository is not yet ready to implement any live GHL or Crazytel integration logic because the required confirmation is still missing.

The current verified state is:

- GHL: general docs confirm OAuth/private integration auth and a broad API surface, but not the exact account contract needed for this application.
- Crazytel: product/site docs confirm a VoIP provider and supported services, but not the actual API contract, call flow, or recording/webhook implementation details needed for a safe production integration.

The app should proceed only after the missing evidence above is provided and recorded in the account-specific configuration or implementation docs.

## 6) Immediate next action

The next step is to obtain the exact verified account/configuration details from the owner for both systems and then re-run Stage 2 against those account-specific facts. Until then, all live integration logic must remain explicitly blocked and must not be treated as complete.

## 7) Owner-confirmed GHL contact management contract (2026-10-09)

The owner confirmed the GHL Private Integration is installed and granted contact read/write, custom-field read, and user read scopes. No credential value is recorded here.

Official v3 documentation checked for this implementation:

- [Contacts API v3](https://marketplace.gohighlevel.com/docs/ghl/contacts/contacts-api-v-3) states bearer auth accepts a Sub-Account Private Integration token and requires the API Version header.
- [Get Contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/get-contact) documents `GET /contacts/:contactId`.
- [Update Contact](https://marketplace.gohighlevel.com/docs/ghl/contacts/update-contact) documents `PUT /contacts/:contactId`, `assignedTo` as the user ID, and `customFields` entries containing `id`, `key`, and `fieldValue`.
- [Get Custom Fields](https://marketplace.gohighlevel.com/docs/ghl/locations/get-custom-fields) documents `GET /locations/:locationId/customFields?model=contact` and the `locations/customFields.readonly` scope.
- [Get User](https://marketplace.gohighlevel.com/docs/ghl/users/get-user) documents `GET /users/:userId` and the `users.readonly` scope. This app continues to use explicitly provisioned Supabase profile mappings for agent IDs.

Implementation behavior:

- Admin contact reads are location-scoped, paginated GHL reads. They do not filter by assignment or status.
- Admin bulk changes are restricted to the admin role, active contacts are re-fetched from GHL before mutation, agent assignments must match an active application agent's mapped GHL user ID, and successful mutations use GHL `PUT /contacts/:contactId`.
- Status is read only from `GHL_CONTACT_STATUS_FIELD_ID`; missing values remain Unknown and never become Open. Before status mutation, the server confirms that field ID exists in the selected location's `model=contact` metadata.
- Agents receive only contacts whose `assignedTo` matches their server-side profile's GHL ID and whose configured status value equals `GHL_OPEN_STATUS_VALUE`. Contact detail and action requests re-check those rules against GHL.
- GHL is the source of truth for status/assignment. `contacts_cache` is not used as authority for these workflows.
- The admin sidebar roster and contact assignment dropdown both use active Supabase `agent` profiles that have a GHL user ID mapping. This matches the agent profiles used by dashboard performance. A user must be provisioned/mapped before assignment so the agent queue can authorize and find their contacts.
- The admin sidebar lists every active Supabase `agent` profile used by Agent performance and labels profiles without a GHL mapping as needing setup. Only mapped profiles appear as assignment targets.

Remaining owner configuration and verification:

- Set `GHL_CONTACT_STATUS_FIELD_ID` to the ID for the exact status field created in the GHL location.
- Set `GHL_CONTACT_STATUS_VALUES` to every exact selectable option in that field. `GHL_OPEN_STATUS_VALUE` defaults to `Open`; confirm its spelling/case against the field's options.
- The official docs pages available during this change did not expose the contact-list operation schema. The implementation uses the location-scoped contacts collection with cursor pagination; verify one read against the owner's Private Integration before relying on it operationally. No bulk mutation has been tested against the live account from this workspace.
- Required granted scopes for this flow are `contacts.readonly`, `contacts.write`, `locations/customFields.readonly`, and `users.readonly` for any future user-ID verification. No extra OAuth client credentials are used by the Private Integration path.
- Live GHL contact assignment still requires `contacts.write`. The app sends the selected mapped agent's GHL user ID as `assignedTo`; the agent queue then filters GHL contacts by that same ID and the configured Open status. A live write/read round trip against an approved test contact is still required to confirm the specific account configuration.
