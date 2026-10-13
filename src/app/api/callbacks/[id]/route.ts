import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getGhlContact } from "@/lib/ghl";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { auditAgentPhoneReveal, recordAgentWorkActivity } from "@/lib/work-session-activity";

export const dynamic = "force-dynamic";
const revealLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "agent" || !session.ghlUserId) return NextResponse.json({ error: "Callback is not available." }, { status: 404 });
  if (!isWithinRateLimit(revealLimiter, session.id)) return NextResponse.json({ error: "Number views are temporarily limited. Try again shortly." }, { status: 429 });

  const { id } = await params;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: callback, error } = await supabase.from("callbacks").select("contact_id, agent_id, status").eq("id", id).maybeSingle();
    if (error || !callback || callback.agent_id !== session.id || !["scheduled", "due", "missed"].includes(callback.status)) {
      return NextResponse.json({ error: "Callback is not available." }, { status: 404 });
    }
    const contact = await getGhlContact(callback.contact_id);
    if (!contact?.phone || contact.assignedUserId !== session.ghlUserId) return NextResponse.json({ error: "Callback contact is not available." }, { status: 404 });
    if (!await auditAgentPhoneReveal(contact.id)) return NextResponse.json({ error: "Number access could not be verified. Try again or contact an administrator." }, { status: 503 });
    return NextResponse.json({ phone: contact.phone }, { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });
  } catch {
    return NextResponse.json({ error: "Could not view this number right now." }, { status: 503 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  const { id } = await params;

  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!payload || typeof payload !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const body = payload as Record<string, unknown>;
  try {
    const supabase = await createSupabaseServerClient();
    if (body.action === "complete") {
      const { data, error } = await supabase.rpc("complete_callback", { p_callback_id: id });
      if (error) return NextResponse.json({ error: "Callback could not be completed. Apply the callback actions migration." }, { status: 503 });
      if (!data) return NextResponse.json({ error: "Callback is unavailable or no longer actionable." }, { status: 404 });
      if (session.role === "agent") await recordAgentWorkActivity();
      return NextResponse.json({ ok: true });
    }

    if (body.action === "reschedule" && typeof body.dueAt === "string" && typeof body.timezone === "string") {
      const dueAt = new Date(body.dueAt);
      if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now() || body.timezone.length > 80) {
        return NextResponse.json({ error: "Choose a valid future date and time." }, { status: 400 });
      }
      const { data, error } = await supabase.rpc("reschedule_callback", { p_callback_id: id, p_due_at: dueAt.toISOString(), p_timezone: body.timezone });
      if (error) return NextResponse.json({ error: "Callback could not be rescheduled. Apply the callback actions migration." }, { status: 503 });
      if (!data) return NextResponse.json({ error: "Callback is unavailable or the date/timezone is invalid." }, { status: 404 });
      if (session.role === "agent") await recordAgentWorkActivity();
      return NextResponse.json({ ok: true });
    }
  } catch {
    return NextResponse.json({ error: "Callback action could not be completed." }, { status: 503 });
  }

  return NextResponse.json({ error: "Unsupported callback action." }, { status: 400 });
}