import { NextResponse } from "next/server";

import { listActiveAgentProfiles } from "@/lib/assignable-agents";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { createCompanyCrmClient } from "@/lib/company-database";

export const dynamic = "force-dynamic";
const updateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  if (!isWithinRateLimit(updateLimiter, session.id)) return NextResponse.json({ error: "Too many contact changes. Wait a minute and try again." }, { status: 429 });
  const { id } = await params;
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid contact update." }, { status: 400 }); }
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : name.split(/\s+/)[0] ?? "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : name.split(/\s+/).slice(1).join(" ");
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if ((!firstName && !lastName) || !status || status.length > 80 || email.length > 320 || phone.length > 80 || subject.length > 500 || notes.length > 5000) {
    return NextResponse.json({ error: "Contact name and a valid status are required; check field lengths." }, { status: 400 });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid contact email." }, { status: 400 });
  const assignedAgentId = typeof body.assignedAgentId === "string" && body.assignedAgentId ? body.assignedAgentId : null;
  if (assignedAgentId) {
    const agents = await listActiveAgentProfiles();
    if (!agents.some((agent) => agent.id === assignedAgentId)) return NextResponse.json({ error: "The selected agent is not active in this company." }, { status: 400 });
  }

  const { client: supabase, mode } = await createCompanyCrmClient(session.companyId);
  const args = mode === "shared"
    ? {
      p_contact_id: id,
      p_first_name: firstName,
      p_last_name: lastName,
      p_phone: phone,
      p_email: email,
      p_status: status,
      p_subject: subject,
      p_notes: notes,
      p_assigned_agent_id: assignedAgentId,
    }
    : {
      p_company_id: session.companyId,
      p_contact_id: id,
      p_first_name: firstName,
      p_last_name: lastName,
      p_phone: phone,
      p_email: email,
      p_status: status,
      p_subject: subject,
      p_notes: notes,
      p_assigned_agent_id: assignedAgentId,
      p_actor_id: session.id,
    };
  const rpcClient = mode === "shared" ? createSupabaseServiceClient() : supabase;
  const { data, error } = await rpcClient.rpc("admin_edit_company_contact", args);
  if (error) return NextResponse.json({ error: error.message.includes("company_contact_not_found") ? "Contact is not available in this company." : "Contact could not be updated." }, { status: error.message.includes("company_contact_not_found") ? 404 : 503 });
  if (!data) return NextResponse.json({ error: "Contact is not available in this company." }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}