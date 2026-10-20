import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { getCompanyIntegration, saveCompanyCredentials } from "@/lib/integration-secrets";
import { getCrazytelApiBaseUrl } from "@/lib/crazytel-api";

export const dynamic = "force-dynamic";

type CrazytelTrunk = { id: string; username: string; enabled: boolean; caller_id_number: string | null; description: string | null };

async function getTrunks(baseUrl: string, apiKey: string): Promise<CrazytelTrunk[]> {
  const response = await fetch(new URL("/api/v1/sip-trunks/", getCrazytelApiBaseUrl(baseUrl)), {
    headers: { Accept: "application/json", "X-Crazytel-Api-Key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Crazytel trunk list could not be loaded.");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Crazytel returned an invalid trunk list.");
  return payload.flatMap((item): CrazytelTrunk[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.username !== "string" || typeof row.enabled !== "boolean") return [];
    return [{
      id: row.id,
      username: row.username,
      enabled: row.enabled,
      caller_id_number: typeof row.caller_id_number === "string" ? row.caller_id_number : null,
      description: typeof row.description === "string" ? row.description : null,
    }];
  });
}

async function authorizeAgent(profileId: string, companyId: string) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("company_memberships")
    .select("profile_id, crazytel_trunk_id, crazytel_trunk_username")
    .eq("profile_id", profileId).eq("company_id", companyId).eq("role", "agent").maybeSingle();
  if (error) throw new Error("Apply migration 20261021_000020_agent_crazytel_trunks.sql and try again.");
  if (!data) return null;
  return data;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  try {
    const { id } = await params;
    const membership = await authorizeAgent(id, session.companyId);
    if (!membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    const { config, credentials } = await getCompanyIntegration(session.companyId, "crazytel");
    if (!config?.enabled || !credentials.apiKey) return NextResponse.json({ error: "Enable Crazytel and save its API key in Settings first." }, { status: 409 });
    const baseUrl = typeof config.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io";
    const trunks = (await getTrunks(baseUrl, credentials.apiKey)).filter((trunk) => trunk.enabled);
    return NextResponse.json({
      trunks,
      selectedTrunkId: membership.crazytel_trunk_id,
      selectedUsername: membership.crazytel_trunk_username,
      passwordSaved: Boolean(credentials[`agent-${id}-webrtcPassword`]),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent Crazytel settings could not be loaded.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid Crazytel assignment." }, { status: 400 }); }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const trunkId = typeof record.trunkId === "string" ? record.trunkId : "";
  const username = typeof record.username === "string" ? record.username : "";
  const webrtcPassword = typeof record.webrtcPassword === "string" ? record.webrtcPassword.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(trunkId) || !username || username.length > 120 || !webrtcPassword || webrtcPassword.length > 512) {
    return NextResponse.json({ error: "Choose an enabled SIP trunk and enter its dedicated WebRTC password." }, { status: 400 });
  }
  try {
    const { id } = await params;
    const membership = await authorizeAgent(id, session.companyId);
    if (!membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    const { config, credentials } = await getCompanyIntegration(session.companyId, "crazytel");
    if (!config?.enabled || !credentials.apiKey) return NextResponse.json({ error: "Enable Crazytel and save its API key in Settings first." }, { status: 409 });
    const baseUrl = typeof config.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io";
    const trunks = await getTrunks(baseUrl, credentials.apiKey);
    const selected = trunks.find((trunk) => trunk.id === trunkId && trunk.username === username && trunk.enabled);
    if (!selected) return NextResponse.json({ error: "That enabled Crazytel trunk could not be verified for this account." }, { status: 400 });
    const service = createSupabaseServiceClient();
    const { error } = await service.from("company_memberships").update({
      crazytel_trunk_id: selected.id,
      crazytel_trunk_username: selected.username,
    }).eq("profile_id", id).eq("company_id", session.companyId).eq("role", "agent");
    if (error) return NextResponse.json({ error: "That trunk may already be assigned to another agent, or the assignment could not be saved." }, { status: 409 });
    await saveCompanyCredentials(session.companyId, "crazytel", { [`agent-${id}-webrtcPassword`]: webrtcPassword });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent Crazytel assignment could not be saved.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
