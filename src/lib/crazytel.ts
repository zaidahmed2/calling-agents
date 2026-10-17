import { env } from "@/lib/env";
import { getCompanyIntegration } from "@/lib/integration-secrets";

export type CrazytelWebRtcConfig = {
  websocketServer: string;
  sipUri: string;
  webrtcPassword: string;
  targetUri: string;
  turnUrls: string[];
  turnUsername?: string;
  turnPassword?: string;
};

import { buildCrazytelOutboundTarget } from "@/lib/crazytel-utils";

export { buildCrazytelOutboundTarget } from "@/lib/crazytel-utils";

const isPlaceholder = (value: string) => /your_|change_me|placeholder|example|mock/i.test(value.trim());

export function getCrazytelWebRtcConfig(destinationPhone: string): { ok: true; config: CrazytelWebRtcConfig } | { ok: false; reason: string } {
  if (isPlaceholder(env.crazytelWebrtcSipUri) || isPlaceholder(env.crazytelWebrtcPassword)) {
    return { ok: false, reason: "Crazytel Hybrid WebRTC SIP URI and WebRTC password are not configured on the server." };
  }
  if (!env.crazytelWebrtcWssUrl.startsWith("wss://")) {
    return { ok: false, reason: "Crazytel WebRTC must use a secure WSS signaling URL." };
  }
  if (isPlaceholder(env.crazytelOutboundUriTemplate)) {
    return { ok: false, reason: "Set CRAZYTEL_OUTBOUND_URI_TEMPLATE to the outbound SIP destination format confirmed for your Hybrid trunk." };
  }
  const targetUri = buildCrazytelOutboundTarget(env.crazytelOutboundUriTemplate, destinationPhone);
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
    },
  };
}

export async function getCompanyCrazytelWebRtcConfig(companyId: string, destinationPhone: string): Promise<{ ok: true; config: CrazytelWebRtcConfig } | { ok: false; reason: string }> {
  let integration;
  try {
    integration = await getCompanyIntegration(companyId, "crazytel");
  } catch {
    return { ok: false, reason: "Company calling settings could not be loaded. Check the integration encryption key." };
  }
  const { config, credentials } = integration;
  const settings = config?.settings ?? {};
  if (!config?.enabled) return { ok: false, reason: "Calling is not enabled for this company. Ask an administrator to configure a provider." };
  const sipUri = credentials.webrtcSipUri ?? "";
  const webrtcPassword = credentials.webrtcPassword ?? "";
  const websocketServer = typeof settings.websocketUrl === "string" ? settings.websocketUrl : "wss://hybrid.sip.crazytel.net.au:8443";
  const outboundTemplate = typeof settings.outboundUriTemplate === "string" ? settings.outboundUriTemplate : "";
  if (!sipUri.trim() || !webrtcPassword.trim()) return { ok: false, reason: "Company Crazytel WebRTC identity and password are not configured." };
  if (!websocketServer.startsWith("wss://")) return { ok: false, reason: "Crazytel WebRTC must use a secure WSS signaling URL." };
  if (!outboundTemplate.trim()) return { ok: false, reason: "Set the company outbound SIP URI template confirmed for its Hybrid trunk." };
  const targetUri = buildCrazytelOutboundTarget(outboundTemplate, destinationPhone);
  if (!targetUri) return { ok: false, reason: "The company outbound SIP URI template or contact phone number is invalid." };
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
    },
  };
}
