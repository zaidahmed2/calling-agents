import { NextResponse } from "next/server";

import { listCompanyAgentProfiles } from "@/lib/assignable-agents";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const agentLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });

    if (!session.companyId) return NextResponse.json({ error: "Company access is not configured." }, { status: 403 });
    const agents = await listCompanyAgentProfiles(session.companyId);
    const ids = agents.map((agent) => agent.id);
    const stats = new Map(ids.map((id) => [id, { openContacts: 0, calls: 0, callbacks: 0, activeSession: false }]));
    if (ids.length) {
      const supabase = await createSupabaseServerClient();
      const [contacts, calls, callbacks, sessions] = await Promise.all([
        supabase.from("contacts").select("assigned_agent_id").eq("company_id", session.companyId).eq("status", "open").in("assigned_agent_id", ids),
        supabase.from("calls").select("agent_id").eq("company_id", session.companyId).in("agent_id", ids),
        supabase.from("callbacks").select("agent_id").eq("company_id", session.companyId).in("agent_id", ids).in("status", ["scheduled", "due", "missed"]),
        supabase.from("work_sessions").select("agent_id").eq("company_id", session.companyId).in("agent_id", ids).in("state", ["active", "paused"]),
      ]);
      for (const row of contacts.data ?? []) if (row.assigned_agent_id) stats.get(row.assigned_agent_id)!.openContacts += 1;
      for (const row of calls.data ?? []) stats.get(row.agent_id)!.calls += 1;
      for (const row of callbacks.data ?? []) stats.get(row.agent_id)!.callbacks += 1;
      for (const row of sessions.data ?? []) stats.get(row.agent_id)!.activeSession = true;
      if (contacts.error || calls.error || callbacks.error || sessions.error) throw new Error("Company agent activity could not be loaded.");
    }

    return NextResponse.json({
      users: agents.map((agent) => ({
        id: agent.ghlUserId ?? agent.id,
        profileId: agent.id,
        name: agent.name,
        email: agent.email,
        role: "agent",
        isActive: agent.isActive,
        isMappedAgent: true,
        appEmail: agent.email,
        ...stats.get(agent.id),
      })),
      total: agents.length,
    });
  } catch {
    return NextResponse.json({ error: "Agent profiles could not be loaded. Check the database connection and try again." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  if (!isWithinRateLimit(agentLimiter, session.id)) return NextResponse.json({ error: "Too many agent invitations. Try again shortly." }, { status: 429 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid agent invitation." }, { status: 400 }); }
  const email = body && typeof body === "object" && typeof (body as Record<string, unknown>).email === "string"
    ? ((body as Record<string, unknown>).email as string).trim().toLowerCase()
    : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid agent email." }, { status: 400 });

  let service;
  try { service = createSupabaseServiceClient(); } catch {
    return NextResponse.json({ error: "Agent onboarding requires server-side Supabase service credentials." }, { status: 503 });
  }
  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl}/login` });
  if (inviteError || !invited.user) return NextResponse.json({ error: inviteError?.message.includes("already") ? "That email already has an Auth account. Ask the platform administrator to link it." : "The agent invitation could not be sent." }, { status: 409 });

  const userId = invited.user.id;
  const { error: profileError } = await service.from("profiles").insert({ id: userId, normalized_email: email, ghl_user_id: null, app_role: "agent", is_active: true });
  const { error: membershipError } = profileError
    ? { error: profileError }
    : await service.from("company_memberships").insert({ profile_id: userId, company_id: session.companyId, role: "agent", is_active: true });
  if (profileError || membershipError) {
    await service.from("company_memberships").delete().eq("profile_id", userId);
    await service.from("profiles").delete().eq("id", userId);
    await service.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: "The agent profile and company membership could not be provisioned." }, { status: 503 });
  }

  return NextResponse.json({ agent: { id: userId, email, isActive: true } }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid agent update." }, { status: 400 }); }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const profileId = typeof record.profileId === "string" ? record.profileId : "";
  const isActive = record.isActive;
  if (!profileId || typeof isActive !== "boolean") return NextResponse.json({ error: "Choose an agent and activation state." }, { status: 400 });

  try {
    const service = createSupabaseServiceClient();
    const { data: membership, error: lookupError } = await service.from("company_memberships")
      .select("profile_id").eq("profile_id", profileId).eq("company_id", session.companyId).eq("role", "agent").maybeSingle();
    if (lookupError || !membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    const { error: memberError } = await service.from("company_memberships").update({ is_active: isActive })
      .eq("profile_id", profileId).eq("company_id", session.companyId);
    const { error: profileError } = await service.from("profiles").update({ is_active: isActive }).eq("id", profileId);
    if (memberError || profileError) return NextResponse.json({ error: "Agent activation could not be updated." }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Agent activation could not be updated." }, { status: 503 });
  }
}