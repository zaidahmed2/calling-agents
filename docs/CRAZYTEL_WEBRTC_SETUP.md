# Crazytel Hybrid SIP WebRTC Setup

## Confirmed from Crazytel docs

- Browser calling is provided by a **Hybrid SIP trunk** WebRTC softphone, not by the Crazytel HTTP API key.
- WebSocket signaling: `wss://hybrid.sip.crazytel.net.au:8443`.
- The WebRTC SIP identity has the form `sip:<hybrid-username>@hybrid.sip.crazytel.net.au`.
- WebRTC has its own password, separate from the trunk's SIP password. Enable WebRTC in the Hybrid trunk settings first.
- TURN relay: `turn.crazytel.net`, UDP port `3478`, TLS port `5349`.
- Crazytel's server API base URL is `https://api.crazytel.io`; the API key uses the `X-Crazytel-Api-Key` header.
- The official API lists SIP trunks at `GET /api/v1/sip-trunks/` and Hybrid SIPREC call recordings at `GET /api/v1/hybrid-sip-trunks/siprec-recordings`. Recording metadata is joined using `sip_call_id` to the SIP.js Call-ID; the `call_uuid` is used only for recording resources.
- Crazytel provides `GET /api/v1/hybrid-sip-trunks/siprec-recordings/{call_uuid}/stream` for protected recording playback. This app requests that stream only after verifying the signed-in user can access the CRM call.
- The deprecated `GET /api/v1/cdrs/` returns billing/detail records but is not used for recording playback. Provider-verified duration reconciliation is still separate from browser-reported call timing.

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

4. Set the **outbound SIP Request-URI** syntax confirmed by Crazytel for PSTN numbers in `CRAZYTEL_OUTBOUND_URI_TEMPLATE`, using `{number}` for the destination.
5. Crazytel's public WebRTC guide lists TURN host/ports but does not specify whether your account needs TURN credentials. Leave the optional username/password empty unless Crazytel supplies them. If supplied, configure both.
6. Configure the trunk's caller ID in Crazytel as a verified CLI. The app does not spoof a caller ID in SIP requests.
7. In Settings, select **Verify API & calling setup**. It checks the API balance, SIP trunk list, and Hybrid recording list endpoints, plus the presence of the company WebRTC identity. It does not place a call or prove SIP registration.
8. For dedicated trunks, open **Agents → Agent activity**, choose that agent's enabled trunk, enter its WebRTC password, click **Test WebRTC login**, and only then assign it. A successful SIP REGISTER confirms authentication/connectivity; it does not place a call.
9. Sign in as the agent and use an approved test contact and destination. Browser microphone access requires HTTPS in deployment; localhost is allowed for local development.

## Credential and call-truth notes

- The Crazytel API key stays server-side. It is used only for HTTPS API operations such as the Settings credential check; it is not used to authenticate WebRTC media. Crazytel's documented API uses one API key; no separate API secret is required.
- SIP.js must receive a SIP identity and WebRTC password in the agent's browser to register and establish WebRTC. This is inherently visible to that authenticated agent/browser session. Prefer distinct Crazytel Hybrid trunks/WebRTC credentials per agent and rotate them when access changes.
- The app can assign one enabled Crazytel SIP trunk to each company agent and stores that agent's WebRTC password encrypted with the company's integration credentials. The admin must apply the central agent-trunk migration first.
- The app sends call audio directly between the browser and Crazytel over WebRTC; the Next.js server does not proxy or record call audio.
- Call recording playback is available only when Crazytel has actually created a recording and the account API key has permission to read it. The admin call log and contact call history look up recordings by SIP Call-ID and use the authenticated provider stream endpoint. Browser call duration remains agent-reported until provider CDR/webhook reconciliation is implemented.
- Outbound dial target format is intentionally required configuration. The implementation refuses to start until `CRAZYTEL_OUTBOUND_URI_TEMPLATE` is set, to avoid guessing a SIP route and placing a misrouted/charged call.
