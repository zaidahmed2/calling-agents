import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getOpenContactForAgent } from "@/lib/ghl";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { auditAgentPhoneReveal, recordAgentWorkActivity } from "@/lib/work-session-activity";

export const dynamic = "force-dynamic";

const revealLimiter = createRateLimiter({
  limit: Math.max(1, env.callRevealRateLimitPerMinute),
  windowMs: 60_000,
});

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "agent" || !session.ghlUserId) {
    return NextResponse.json({ error: "This contact is not available." }, { status: 404 });
  }
  if (!isWithinRateLimit(revealLimiter, session.id)) {
    return NextResponse.json({ error: "Number views are temporarily limited. Try again shortly." }, { status: 429 });
  }

  const { id } = await params;
  const contact = await getOpenContactForAgent(id, session.ghlUserId);
  if (!contact?.phone) return NextResponse.json({ error: "This contact is not available." }, { status: 404 });
  if (!await auditAgentPhoneReveal(contact.id)) return NextResponse.json({ error: "Number access could not be verified. Try again or contact an administrator." }, { status: 503 });
  await recordAgentWorkActivity();

  return NextResponse.json({ phone: contact.phone }, {
    headers: {
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
    },
  });
}