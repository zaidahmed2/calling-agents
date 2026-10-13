# Crazytel Hybrid SIP WebRTC Setup

## Confirmed from Crazytel docs

- Browser calling is provided by a **Hybrid SIP trunk** WebRTC softphone, not by the Crazytel HTTP API key.
- WebSocket signaling: `wss://hybrid.sip.crazytel.net.au:8443`.
- The WebRTC SIP identity has the form `sip:<hybrid-username>@hybrid.sip.crazytel.net.au`.
- WebRTC has its own password, separate from the trunk's SIP password. Enable WebRTC in the Hybrid trunk settings first.
- TURN relay: `turn.crazytel.net`, UDP port `3478`, TLS port `5349`.
- Crazytel's server API base URL is `https://api.crazytel.io`; the API key uses the `X-Crazytel-Api-Key` header. The app's Settings check uses the read-only `GET /api/v1/balance/` endpoint, discards the response body, and never places a call.
- Crazytel advertises Hybrid call event webhooks signed with HMAC-SHA256 and CDR/recording APIs. Those provider events still need account-specific verification and reconciliation before this app can label duration/provider IDs as verified.

## Owner setup

1. Ensure the Crazytel product is a **Hybrid SIP trunk**, not a standard SIP trunk. Enable WebRTC for the selected trunk.
2. Copy that trunk's WebRTC SIP URI and its separate WebRTC password from Crazytel MyAccount.
3. Set these server-side variables in `.env.local`; never use `NEXT_PUBLIC_` prefixes:

```dotenv
CRAZYTEL_API_BASE_URL=https://api.crazytel.io
CRAZYTEL_API_KEY=your_crazytel_api_key
CRAZYTEL_WEBRTC_SIP_URI=sip:YOUR_HYBRID_USERNAME@hybrid.sip.crazytel.net.au
CRAZYTEL_WEBRTC_PASSWORD=your_hybrid_webrtc_password
CRAZYTEL_WEBRTC_WSS_URL=wss://hybrid.sip.crazytel.net.au:8443
CRAZYTEL_OUTBOUND_URI_TEMPLATE=
CRAZYTEL_TURN_USERNAME=
CRAZYTEL_TURN_PASSWORD=
CRAZYTEL_CALLER_ID=your_verified_caller_id
```

4. Ask Crazytel support to confirm the exact **outbound SIP Request-URI** syntax your Hybrid trunk accepts for PSTN numbers, including required country-code format. Put that format in `CRAZYTEL_OUTBOUND_URI_TEMPLATE` using `{number}` for the normalized destination. Example shape only (not verified; do not use as-is): `sip:{number}@YOUR_CONFIRMED_OUTBOUND_DOMAIN`.
5. Crazytel's public WebRTC guide lists TURN host/ports but does not specify whether your account needs TURN credentials. Leave the optional username/password empty unless Crazytel supplies them. If supplied, configure both.
6. Configure the trunk's caller ID in Crazytel as a verified CLI. The app does not spoof a caller ID in SIP requests.
7. Restart the app, sign in as an agent, and use an approved test contact and destination. Browser microphone access requires HTTPS in deployment; localhost is allowed for local development.

## Credential and call-truth notes

- The Crazytel API key stays server-side. It is used only for HTTPS API operations such as the Settings credential check; it is not used to authenticate WebRTC media. Crazytel's documented API uses one API key; no separate API secret is required.
- SIP.js must receive a SIP identity and WebRTC password in the agent's browser to register and establish WebRTC. This is inherently visible to that authenticated browser session. A single shared trunk password is therefore not secret from agents or browser devtools. Prefer distinct Crazytel Hybrid trunks/WebRTC credentials per agent if Crazytel/account setup permits; otherwise restrict this CRM to trusted agents and rotate the WebRTC password when access changes.
- The app sends call audio directly between the browser and Crazytel over WebRTC; the Next.js server does not proxy or record audio.
- A SIP.js session and browser timer are not independently provider-verified evidence. Until Crazytel call events/CDR are securely correlated and persisted, the CRM labels the current duration as agent-reported. Recording remains disabled unless separately approved/configured under applicable call-recording requirements.
- Outbound dial target format is intentionally required configuration. The implementation refuses to start until `CRAZYTEL_OUTBOUND_URI_TEMPLATE` is set, to avoid guessing a SIP route and placing a misrouted/charged call.
