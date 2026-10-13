# GHL Call Fields

Create these as **Contact** custom fields in the same GHL location configured by `GHL_LOCATION_ID`:

| Field label | GHL field type | Options / value | Environment key |
| --- | --- | --- | --- |
| Call Stage | Dropdown / single select | Picked, Not picked, Call later, Busy, Interested | `GHL_CALL_STAGE_FIELD_KEY` |
| Call Notes | Multi-line text | Free text from the agent's call message | `GHL_CALL_NOTES_FIELD_KEY` |
| Callback At (UTC) | Single-line text | ISO 8601 timestamp in UTC, for example `2026-10-11T08:30:00.000Z` | `GHL_CALLBACK_AT_FIELD_KEY` |

After creating each field, copy its **field key** from GHL's custom-field details/API metadata into the matching server-side environment variable. Use the key, not the display label or field ID. Restart the app after changing local environment settings. Do not prefix these variables with `NEXT_PUBLIC_`.

The contact update writes the selected stage and message on every saved call. If a callback is scheduled, its UTC timestamp is written to `Callback At (UTC)`; this field is cleared for later non-callback outcomes when configured. For full `Call later` sync, configure all three keys.

Every call and note is also saved in Supabase: the stage is in `calls.outcome` and `call_dispositions.outcome`, the message is in `call_dispositions.note`, and scheduled callbacks are in `callbacks`. Supabase is the historical record; GHL contact fields are a latest-value snapshot and will be overwritten by the next call to that contact. The app records the GHL sync result on `calls.sync_state` and reports a failed or unconfigured sync after the local save.

The current dial action opens the device's phone app using `tel:` after the agent starts the call log. It does not create a Crazytel call. The duration is based on agent start/end confirmation and is not provider-verified.
