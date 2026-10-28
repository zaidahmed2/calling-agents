import { env } from "@/lib/env";
import { getCompanyIntegration } from "@/lib/integration-secrets";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export type CrazytelWebRtcConfig = {
  websocketServer: string;
  sipUri: string;
  webrtcPassword: string;
  targetUri: string;
  turnUrls: string[];
  turnUsername?: string;
  turnPassword?: string;
  outboundCallerId?: string;
  recordingNoticeEnabled: boolean;
};

import { buildCrazytelCallerIdHeaders, buildCrazytelOutboundTarget, CRAZYTEL_OUTBOUND_URI_TEMPLATE } from "@/lib/crazytel-utils";

export { buildCrazytelCallerIdHeaders, buildCrazytelOutboundTarget, CRAZYTEL_OUTBOUND_URI_TEMPLATE } from "@/lib/crazytel-utils";

const isPlaceholder = (value: string) => /your_|change_me|placeholder|example|mock/i.test(value.trim());

export function getCrazytelWebRtcConfig(destinationPhone: string): { ok: true; config: CrazytelWebRtcConfig } | { ok: false; reason: string } {
  if (isPlaceholder(env.crazytelWebrtcSipUri) || isPlaceholder(env.crazytelWebrtcPassword)) {
    return { ok: false, reason: "Crazytel Hybrid WebRTC SIP URI and WebRTC password are not configured on the server." };
  }
  if (!env.crazytelWebrtcWssUrl.startsWith("wss://")) {
    return { ok: false, reason: "Crazytel WebRTC must use a secure WSS signaling URL." };
  }
  const targetUri = buildCrazytelOutboundTarget(CRAZYTEL_OUTBOUND_URI_TEMPLATE, destinationPhone);
  if (!targetUri) return { ok: false, reason: "The Crazytel outbound SIP URI template or contact phone number is invalid." };

  const hasTurnCredentials = Boolean(env.crazytelTurnUsername.trim() && env.crazytelTurnPassword.trim());
  const turnUrls = hasTurnCredentials
    ? ["turn:turn.crazytel.net:3478?transport=udp", "turns:turn.crazytel.net:5349?transport=tcp"]
    : ["stun:stun.l.google.com:19302"];
  return {
    ok: true,
    config: {
      websocketServer: env.crazytelWebrtcWssUrl,
      sipUri: env.crazytelWebrtcSipUri,
      webrtcPassword: env.crazytelWebrtcPassword,
      targetUri,
      turnUrls,
      ...(hasTurnCredentials ? { turnUsername: env.crazytelTurnUsername, turnPassword: env.crazytelTurnPassword } : {}),
      recordingNoticeEnabled: env.crazytelRecordingEnabled,
    },
  };
}

export async function getCompanyCrazytelWebRtcConfig(companyId: string, agentId: string, destinationPhone: string): Promise<{ ok: true; config: CrazytelWebRtcConfig } | { ok: false; reason: string }> {
  let integration;
  try {
    integration = await getCompanyIntegration(companyId, "crazytel");
  } catch {
    return { ok: false, reason: "Company calling settings could not be loaded. Check the integration encryption key." };
  }
  const { config, credentials } = integration;
  const settings = config?.settings ?? {};
  if (!config?.enabled) return { ok: false, reason: "Calling is not enabled for this company. Ask an administrator to configure a provider." };
  let assignedUsername: string | null = null;
  let assignedCallerId: string | null = null;
  try {
    const { data: membership, error } = await createSupabaseServiceClient().from("company_memberships")
      .select("crazytel_trunk_username, crazytel_caller_id")
      .eq("company_id", companyId).eq("profile_id", agentId).eq("role", "agent")
      .maybeSingle();
    if (error) throw error;
    assignedUsername = typeof membership?.crazytel_trunk_username === "string" ? membership.crazytel_trunk_username : null;
    assignedCallerId = typeof membership?.crazytel_caller_id === "string" ? membership.crazytel_caller_id : null;
  } catch {
    return { ok: false, reason: "Agent Crazytel assignment could not be loaded. Apply migrations 20261021_000020_agent_crazytel_trunks.sql, 20261022_000022_agent_crazytel_caller_ids.sql, and 20261023_000023_agent_crazytel_outbound_uri.sql, then check Settings." };
  }
  const sipUri = assignedUsername ? `sip:${assignedUsername}@hybrid.sip.crazytel.net.au` : credentials.webrtcSipUri ?? "";
  const webrtcPassword = assignedUsername ? credentials[`agent-${agentId}-webrtcPassword`] ?? "" : credentials.webrtcPassword ?? "";
  const websocketServer = typeof settings.websocketUrl === "string" ? settings.websocketUrl : "wss://hybrid.sip.crazytel.net.au:8443";
  const outboundTemplate = CRAZYTEL_OUTBOUND_URI_TEMPLATE;
  if (!sipUri.trim() || !webrtcPassword.trim()) return { ok: false, reason: "Company Crazytel WebRTC identity and password are not configured." };
  if (!websocketServer.startsWith("wss://")) return { ok: false, reason: "Crazytel WebRTC must use a secure WSS signaling URL." };
  const targetUri = buildCrazytelOutboundTarget(outboundTemplate, destinationPhone);
  if (!targetUri) return { ok: false, reason: "The contact phone number is invalid for Crazytel calling. Check that it includes a valid country or area code." };
  const passthroughEnabled = settings.callerIdPassthroughEnabled === true;
  const outboundCallerId = passthroughEnabled && assignedCallerId && buildCrazytelCallerIdHeaders(assignedCallerId).length
    ? assignedCallerId
    : undefined;
  const turnUsername = credentials.turnUsername ?? "";
  const turnPassword = credentials.turnPassword ?? "";
  const hasTurnCredentials = Boolean(turnUsername.trim() && turnPassword.trim());
  return {
    ok: true,
    config: {
      websocketServer,
      sipUri,
      webrtcPassword,
      targetUri,
      turnUrls: hasTurnCredentials ? ["turn:turn.crazytel.net:3478?transport=udp", "turns:turn.crazytel.net:5349?transport=tcp"] : ["stun:stun.l.google.com:19302"],
      ...(hasTurnCredentials ? { turnUsername, turnPassword } : {}),
      ...(outboundCallerId ? { outboundCallerId } : {}),
      recordingNoticeEnabled: env.crazytelRecordingEnabled,
    },
  };
}
