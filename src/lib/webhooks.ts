import crypto from "node:crypto";

import { env } from "@/lib/env";

export type WebhookStatus = "accepted" | "rejected" | "blocked";

export type WebhookValidationResult = {
  status: WebhookStatus;
  reason?: string;
  providerEventId?: string;
  payload?: Record<string, unknown>;
};

const PLACEHOLDER_PATTERN = /your_|change_me|placeholder|example|mock/i;

const isMissingOrPlaceholder = (value?: string) => !value || value.trim() === "" || PLACEHOLDER_PATTERN.test(value);

const getHeaders = (request: Request, names: string[]) => {
  const lower = new Map<string, string>();

  request.headers.forEach((value, key) => {
    lower.set(key.toLowerCase(), value);
  });

  for (const name of names) {
    const value = lower.get(name.toLowerCase());
    if (value) {
      return value;
    }
  }

  return undefined;
};

export async function validateSignedWebhook({
  request,
  secretKey,
  secretName,
  signatureHeaderNames,
  body,
}: {
  request: Request;
  secretKey?: string;
  secretName: string;
  signatureHeaderNames: string[];
  body: string;
}): Promise<WebhookValidationResult> {
  if (isMissingOrPlaceholder(secretKey) || isMissingOrPlaceholder(env[secretName as keyof typeof env] as string | undefined)) {
    return {
      status: "blocked",
      reason: `${secretName} is not configured for the live provider account. Incoming webhooks are rejected until verification is complete.`,
    };
  }

  const signature = getHeaders(request, signatureHeaderNames);
  if (!signature) {
    return {
      status: "rejected",
      reason: "Missing provider signature header on webhook request.",
    };
  }

  const expected = crypto
    .createHmac("sha256", secretKey || "")
    .update(body, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    return {
      status: "rejected",
      reason: "Webhook signature mismatch. Request was rejected.",
    };
  }

  return {
    status: "accepted",
  };
}

export function normalizeWebhookEventId(payload: Record<string, unknown>) {
  const candidates = [
    payload.eventId,
    payload.id,
    payload.callId,
    payload.event_id,
    payload.externalId,
    payload.providerEventId,
  ];

  const match = candidates.find((value) => typeof value === "string" && value.trim() !== "");
  return typeof match === "string" ? match : `webhook-${Date.now()}`;
}

export function buildBlockedResponse(message: string) {
  return {
    ok: false,
    blocked: true,
    status: "blocked",
    message,
  };
}
