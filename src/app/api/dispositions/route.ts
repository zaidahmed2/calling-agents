import { NextResponse } from "next/server";

import { normalizeOutcome, syncDispositionToGhl } from "@/lib/dispositions";
import { getSession } from "@/lib/session";

export async function POST(request: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ ok: false, blocked: true, status: "blocked", message: "You must be authenticated to submit a call disposition." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const outcome = typeof payload.outcome === "string" ? normalizeOutcome(payload.outcome) : "follow-up";
    const result = await syncDispositionToGhl({
      contactId: String(payload.contactId ?? "unknown-contact"),
      agentId: session.email,
      outcome,
      notes: typeof payload.notes === "string" ? payload.notes : undefined,
      qualified: Boolean(payload.qualified),
      callbackAt: typeof payload.callbackAt === "string" ? payload.callbackAt : undefined,
      providerCallId: typeof payload.providerCallId === "string" ? payload.providerCallId : undefined,
    });

    return NextResponse.json(result, {
      status: result.blocked ? 503 : 200,
    });
  } catch {
    return NextResponse.json({
      ok: false,
      blocked: true,
      status: "blocked",
      message: "Disposition payload was invalid or incomplete.",
    }, { status: 400 });
  }
}
