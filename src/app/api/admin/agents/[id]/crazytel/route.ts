import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { getCompanyIntegration, saveCompanyCredentials } from "@/lib/integration-secrets";
import { getCrazytelApiBaseUrl } from "@/lib/crazytel-api";
import { CRAZYTEL_OUTBOUND_URI_TEMPLATE } from "@/lib/crazytel-utils";

export const dynamic = "force-dynamic";

type CrazytelTrunk = { id: string; username: string; enabled: boolean; caller_id_number: string | null; description: string | null; manual?: boolean };
type VerifiedCallerId = { number: string };

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

async function getVerifiedCallerIds(baseUrl: string, apiKey: string): Promise<VerifiedCallerId[]> {
  const response = await fetch(new URL("/api/v1/account/verified-cli/", getCrazytelApiBaseUrl(baseUrl)), {
    headers: { Accept: "application/json", "X-Crazytel-Api-Key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("Crazytel verified caller IDs could not be loaded.");
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Crazytel returned an invalid verified caller ID list.");
  return payload.flatMap((item): VerifiedCallerId[] => {
    if (!item || typeof item !== "object") return [];
    const number = (item as Record<string, unknown>).number;
    return typeof number === "string" ? [{ number }] : [];
  });
}

async function authorizeAgent(profileId: string, companyId: string) {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.from("company_memberships")
    .select("profile_id, crazytel_trunk_id, crazytel_trunk_username, crazytel_caller_id, crazytel_outbound_uri_template")
    .eq("profile_id", profileId).eq("company_id", companyId).eq("role", "agent").maybeSingle();
  if (error) throw new Error("Apply migrations 20261021_000020_agent_crazytel_trunks.sql, 20261022_000022_agent_crazytel_caller_ids.sql, and 20261023_000023_agent_crazytel_outbound_uri.sql and try again.");
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
    const service = createSupabaseServiceClient();
    const [providerTrunks, assignments] = await Promise.all([
      getTrunks(baseUrl, credentials.apiKey),
      service.from("company_memberships").select("profile_id, crazytel_trunk_id").eq("company_id", session.companyId).eq("role", "agent"),
    ]);
    if (assignments.error) throw new Error("Existing Crazytel trunk assignments could not be loaded.");
    const assignedElsewhere = new Set((assignments.data ?? [])
      .filter((assignment) => assignment.profile_id !== id && assignment.crazytel_trunk_id)
      .map((assignment) => assignment.crazytel_trunk_id));
    const trunks = providerTrunks.filter((trunk) => trunk.enabled).map((trunk) => ({
      ...trunk,
      assignedToOtherAgent: assignedElsewhere.has(trunk.id),
    }));
    if (
      membership.crazytel_trunk_id
      && membership.crazytel_trunk_username
      && !trunks.some((trunk) => trunk.id === membership.crazytel_trunk_id)
    ) {
      trunks.push({
        id: membership.crazytel_trunk_id,
        username: membership.crazytel_trunk_username,
        enabled: true,
        caller_id_number: membership.crazytel_caller_id,
        description: "Manually added Hybrid trunk",
        manual: true,
        assignedToOtherAgent: false,
      });
    }
    return NextResponse.json({
      trunks,
      selectedTrunkId: membership.crazytel_trunk_id,
      selectedUsername: membership.crazytel_trunk_username,
      selectedCallerId: membership.crazytel_caller_id,
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
  const callerId = typeof record.callerId === "string" ? record.callerId.trim() : "";
  const manual = record.manual === true;
  const webrtcPassword = typeof record.webrtcPassword === "string" ? record.webrtcPassword.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trunkId)
    || !/^[A-Za-z0-9._+-]{1,120}$/.test(username)
    || !webrtcPassword
    || webrtcPassword.length > 512) {
    return NextResponse.json({ error: "Choose a SIP trunk and enter its dedicated WebRTC password." }, { status: 400 });
  }
  try {
    const { id } = await params;
    const membership = await authorizeAgent(id, session.companyId);
    if (!membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    const { config, credentials } = await getCompanyIntegration(session.companyId, "crazytel");
    if (!config?.enabled || !credentials.apiKey) return NextResponse.json({ error: "Enable Crazytel and save its API key in Settings first." }, { status: 409 });
    const baseUrl = typeof config.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io";
    const trunks = await getTrunks(baseUrl, credentials.apiKey);
    const selected = manual
      ? null
      : trunks.find((trunk) => trunk.id === trunkId && trunk.username === username && trunk.enabled);
    if (!manual && !selected) return NextResponse.json({ error: "That enabled Crazytel trunk could not be verified for this account." }, { status: 400 });
    const requestedCallerId = manual ? callerId : selected?.caller_id_number ?? "";
    const requestedCallerIdDigits = requestedCallerId.replace(/\D/g, "");
    if (requestedCallerIdDigits.length < 8 || requestedCallerIdDigits.length > 15) {
      return NextResponse.json({ error: "Enter the caller ID configured on this Hybrid trunk." }, { status: 400 });
    }
    const verifiedCallerIds = await getVerifiedCallerIds(baseUrl, credentials.apiKey);
    const verifiedCallerId = verifiedCallerIds.find((item) =>
      item.number.replace(/\D/g, "") === requestedCallerIdDigits,
    );
    if (!verifiedCallerId) {
      return NextResponse.json({ error: "The caller ID must be verified and active on this Crazytel account." }, { status: 409 });
    }
    const selectedCallerId = verifiedCallerId.number;
    const service = createSupabaseServiceClient();
    if (manual) {
      const { data: existingAssignments, error: existingError } = await service.from("company_memberships")
        .select("profile_id, crazytel_trunk_username")
        .eq("company_id", session.companyId)
        .eq("role", "agent");
      if (existingError) throw new Error("Existing Crazytel trunk assignments could not be checked.");
      if ((existingAssignments ?? []).some((assignment) =>
        assignment.profile_id !== id
        && assignment.crazytel_trunk_username?.toLowerCase() === username.toLowerCase(),
      )) {
        return NextResponse.json({ error: "This Crazytel SIP username is already assigned to another agent." }, { status: 409 });
      }
    }
    const updates: Record<string, string | null> = {
      crazytel_trunk_id: trunkId,
      crazytel_trunk_username: username,
      crazytel_caller_id: selectedCallerId,
    };
    updates.crazytel_outbound_uri_template = CRAZYTEL_OUTBOUND_URI_TEMPLATE;
    const { error } = await service.from("company_memberships").update({
      ...updates,
    }).eq("profile_id", id).eq("company_id", session.companyId).eq("role", "agent");
    if (error?.code === "42703") return NextResponse.json({ error: "Apply migration 20261023_000023_agent_crazytel_outbound_uri.sql and try again." }, { status: 503 });
    if (error) return NextResponse.json({ error: "That trunk may already be assigned to another agent, or the assignment could not be saved." }, { status: 409 });
    await saveCompanyCredentials(session.companyId, "crazytel", { [`agent-${id}-webrtcPassword`]: webrtcPassword });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent Crazytel assignment could not be saved.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
