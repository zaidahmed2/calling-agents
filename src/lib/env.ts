type EnvValue = string | undefined;

const read = (key: string): EnvValue => process.env[key];

const required = (key: string): string => {
  const value = read(key);

  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

export const env = {
  appUrl: read("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000",
  appEnv: read("APP_ENV") ?? "development",
  siteName: read("NEXT_PUBLIC_SITE_NAME") ?? "Calling Software",
  supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL") ?? "",
  supabaseAnonKey: read("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? read("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? "",
  supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  supabaseJwtSecret: read("SUPABASE_JWT_SECRET") ?? "",

  ghlPrivateIntegrationKey: read("GHL_PRIVATE_INTEGRATION_KEY") ?? "",
  ghlWebhookSecret: read("GHL_WEBHOOK_SECRET") ?? "",
  ghlLocationId: read("GHL_LOCATION_ID") ?? "",
  ghlContactStatusFieldKey: read("GHL_CONTACT_STATUS_FIELD_KEY") ?? "",
  ghlOpenStatusValue: read("GHL_OPEN_STATUS_VALUE") ?? "Open",
  ghlCallStageFieldKey: read("GHL_CALL_STAGE_FIELD_KEY") ?? "",
  ghlCallNotesFieldKey: read("GHL_CALL_NOTES_FIELD_KEY") ?? "",
  ghlCallbackAtFieldKey: read("GHL_CALLBACK_AT_FIELD_KEY") ?? "",

  crazytelApiBaseUrl: read("CRAZYTEL_API_BASE_URL") ?? "https://api.crazytel.io",
  crazytelApiKey: read("CRAZYTEL_API_KEY") ?? "",
  crazytelWebhookSecret: read("CRAZYTEL_WEBHOOK_SECRET") ?? "",
  crazytelWebrtcSipUri: read("CRAZYTEL_WEBRTC_SIP_URI") ?? "",
  crazytelWebrtcPassword: read("CRAZYTEL_WEBRTC_PASSWORD") ?? "",
  crazytelWebrtcWssUrl: read("CRAZYTEL_WEBRTC_WSS_URL") ?? "wss://hybrid.sip.crazytel.net.au:8443",
  crazytelOutboundUriTemplate: read("CRAZYTEL_OUTBOUND_URI_TEMPLATE") ?? "",
  crazytelTurnUsername: read("CRAZYTEL_TURN_USERNAME") ?? "",
  crazytelTurnPassword: read("CRAZYTEL_TURN_PASSWORD") ?? "",
  crazytelCallerId: read("CRAZYTEL_CALLER_ID") ?? "",
  crazytelTestDestination: read("CRAZYTEL_TEST_DESTINATION") ?? "",
  crazytelRecordingEnabled: (read("CRAZYTEL_RECORDING_ENABLED") ?? "false").toLowerCase() === "true",

  otpRateLimitPerMinute: Number(read("OTP_RATE_LIMIT_PER_MINUTE") ?? 5),
  callRevealRateLimitPerMinute: Number(read("CALL_REVEAL_RATE_LIMIT_PER_MINUTE") ?? 10),
  callInitRateLimitPerMinute: Number(read("CALL_INIT_RATE_LIMIT_PER_MINUTE") ?? 10),
};

export const getRequiredEnv = required;
