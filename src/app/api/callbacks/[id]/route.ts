import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { recordAgentWorkActivity } from "@/lib/work-session-activity";
import { createCompanyCrmClient } from "@/lib/company-database";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  return NextResponse.json({ error: "Phone-number viewing is disabled. Start a call from the callback instead." }, { status: 404 });
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
    if (!session.companyId) return NextResponse.json({ error: "Company access is required." }, { status: 403 });
    const { client: supabase, mode } = await createCompanyCrmClient(session.companyId);
    if (body.action === "complete") {
      const args = mode === "shared"
        ? { p_callback_id: id }
        : { p_company_id: session.companyId, p_callback_id: id, p_actor_id: session.id, p_is_admin: session.role === "admin" };
      const { data, error } = await supabase.rpc("complete_callback", args);
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
      const args = mode === "shared"
        ? { p_callback_id: id, p_due_at: dueAt.toISOString(), p_timezone: body.timezone }
        : { p_company_id: session.companyId, p_callback_id: id, p_actor_id: session.id, p_is_admin: session.role === "admin", p_due_at: dueAt.toISOString(), p_timezone: body.timezone };
      const { data, error } = await supabase.rpc("reschedule_callback", args);
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