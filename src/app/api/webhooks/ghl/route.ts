import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { buildBlockedResponse, normalizeWebhookEventId, validateSignedWebhook } from "@/lib/webhooks";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = env.ghlWebhookSecret;

  const validation = await validateSignedWebhook({
    request,
    secretKey: secret,
    secretName: "ghlWebhookSecret",
    signatureHeaderNames: ["x-ghl-signature", "x-signature", "signature"],
    body: rawBody,
  });

  if (validation.status !== "accepted") {
    return NextResponse.json(
      buildBlockedResponse(validation.reason ?? "GHL webhook rejected."),
      { status: validation.status === "blocked" ? 503 : 401 },
    );
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const providerEventId = normalizeWebhookEventId(payload);

    return NextResponse.json({
      ok: true,
      blocked: false,
      received: true,
      providerEventId,
      processed: false,
      message: "GHL webhook payload accepted for processing after provider validation. Real persistence and event replay logic are still pending account verification.",
    });
  } catch {
    return NextResponse.json(
      buildBlockedResponse("Malformed JSON payload on GHL webhook request."),
      { status: 400 },
    );
  }
}
