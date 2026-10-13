import { env } from "@/lib/env";

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
