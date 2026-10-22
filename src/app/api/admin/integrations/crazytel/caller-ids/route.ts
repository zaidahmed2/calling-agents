import { NextResponse } from "next/server";

import { listCompanyAgentProfiles } from "@/lib/assignable-agents";
import { getCrazytelApiBaseUrl } from "@/lib/crazytel-api";
import { getCompanyIntegration } from "@/lib/integration-secrets";
import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

type VerifiedCallerId = { id: string; number: string; nickname: string | null; domain: string | null };
type CrazytelTrunk = { username: string; callerIdNumber: string | null };

async function fetchVerifiedCallerIds(baseUrl: string, apiKey: string): Promise<VerifiedCallerId[]> {
  const response = await fetch(new URL("/api/v1/account/verified-cli/", getCrazytelApiBaseUrl(baseUrl)), {
    headers: { Accept: "application/json", "X-Crazytel-Api-Key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Crazytel verified caller IDs could not be loaded (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Crazytel returned an invalid verified caller ID list.");
  return payload.flatMap((item): VerifiedCallerId[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.number !== "string" || !row.number.trim()) return [];
    return [{
      id: typeof row.id === "string" ? row.id : row.number,
      number: row.number,
      nickname: typeof row.nickname === "string" ? row.nickname : null,
      domain: typeof row.domain === "string" ? row.domain : null,
    }];
  });
}

async function fetchTrunkCallerIds(baseUrl: string, apiKey: string): Promise<CrazytelTrunk[]> {
  const response = await fetch(new URL("/api/v1/sip-trunks/", getCrazytelApiBaseUrl(baseUrl)), {
    headers: { Accept: "application/json", "X-Crazytel-Api-Key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Crazytel trunk assignments could not be loaded (HTTP ${response.status}).`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Crazytel returned an invalid SIP trunk list.");
  return payload.flatMap((item): CrazytelTrunk[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.username !== "string") return [];
    return [{
      username: row.username,
      callerIdNumber: typeof row.caller_id_number === "string" ? row.caller_id_number : null,
    }];
  });
}

type AdminSession = NonNullable<Awaited<ReturnType<typeof getSession>>> & { role: "admin"; companyId: string };
type AdminResult = { response: NextResponse } | { session: AdminSession };

async function requireAdmin(): Promise<AdminResult> {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Sign in is required." }, { status: 401 }) };
  if (session.role !== "admin" || !session.companyId) {
    return { response: NextResponse.json({ error: "Company administrator access is required." }, { status: 403 }) };
  }
  const companyId = session.companyId;
  return { session: { ...session, role: "admin", companyId } };
}

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  try {
    const { config, credentials } = await getCompanyIntegration(auth.session.companyId, "crazytel");
    if (!config?.enabled || !credentials.apiKey) {
      return NextResponse.json({ error: "Enable Crazytel and save its API key in Settings first." }, { status: 409 });
    }
    const baseUrl = typeof config.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io";
    const [callerIds, trunks, agents, assignments] = await Promise.all([
      fetchVerifiedCallerIds(baseUrl, credentials.apiKey),
      fetchTrunkCallerIds(baseUrl, credentials.apiKey),
      listCompanyAgentProfiles(auth.session.companyId),
      createSupabaseServiceClient().from("company_memberships")
        .select("profile_id, crazytel_caller_id, crazytel_trunk_username")
        .eq("company_id", auth.session.companyId)
        .eq("role", "agent"),
    ]);
    if (assignments.error) {
      if (assignments.error.code === "42703") throw new Error("Apply migration 20261022_000022_agent_crazytel_caller_ids.sql and try again.");
      throw new Error("Crazytel caller-ID assignments could not be loaded.");
    }
    const assignedIds = new Map((assignments.data ?? []).map((row) => [row.profile_id, {
      callerId: row.crazytel_caller_id,
      trunkUsername: row.crazytel_trunk_username,
    }]));
    const trunkCallers = new Map(trunks.map((trunk) => [trunk.username, trunk.callerIdNumber]));
    return NextResponse.json({
      callerIds,
      agents: agents.map((agent) => {
        const assignment = assignedIds.get(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          callerId: assignment?.callerId ?? null,
          trunkCallerId: assignment?.trunkUsername ? trunkCallers.get(assignment.trunkUsername) ?? null : null,
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Crazytel caller IDs could not be loaded.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  let payload: unknown;
  try { payload = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid caller-ID assignment." }, { status: 400 });
  }
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const callerId = body.callerId === null
    ? null
    : typeof body.callerId === "string"
      ? body.callerId.trim() || null
      : undefined;
  if (!profileId || callerId === undefined || (callerId !== null && callerId.length > 32)) {
    return NextResponse.json({ error: "Choose an agent and a verified caller ID." }, { status: 400 });
  }

  try {
    const service = createSupabaseServiceClient();
    const { data: membership, error: membershipError } = await service.from("company_memberships")
      .select("profile_id")
      .eq("profile_id", profileId)
      .eq("company_id", auth.session.companyId)
      .eq("role", "agent")
      .maybeSingle();
    if (membershipError || !membership) {
      return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    }

    if (callerId) {
      const { config, credentials } = await getCompanyIntegration(auth.session.companyId, "crazytel");
      if (!config?.enabled || !credentials.apiKey) {
        return NextResponse.json({ error: "Enable Crazytel and save its API key in Settings first." }, { status: 409 });
      }
      const baseUrl = typeof config.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io";
      const verifiedCallerIds = await fetchVerifiedCallerIds(baseUrl, credentials.apiKey);
      if (!verifiedCallerIds.some((item) => item.number === callerId)) {
        return NextResponse.json({ error: "Choose a caller ID verified and active on this Crazytel account." }, { status: 400 });
      }
      const [trunks, trunkAssignments] = await Promise.all([
        fetchTrunkCallerIds(baseUrl, credentials.apiKey),
        service.from("company_memberships")
          .select("profile_id, crazytel_trunk_username")
          .eq("company_id", auth.session.companyId)
          .eq("role", "agent"),
      ]);
      if (trunkAssignments.error) throw new Error("Existing trunk caller-ID assignments could not be checked.");
      const trunkCallerIds = new Map(trunks.map((trunk) => [trunk.username, trunk.callerIdNumber]));
      const existingTrunkAgent = (trunkAssignments.data ?? []).find((row) =>
        row.profile_id !== profileId
        && row.crazytel_trunk_username
        && trunkCallerIds.get(row.crazytel_trunk_username) === callerId,
      );
      if (existingTrunkAgent) {
        return NextResponse.json({ error: "That number is already configured as another agent's current trunk caller ID." }, { status: 409 });
      }
      const { data: currentAssignment, error: assignmentError } = await service.from("company_memberships")
        .select("profile_id")
        .eq("company_id", auth.session.companyId)
        .eq("role", "agent")
        .eq("crazytel_caller_id", callerId)
        .maybeSingle();
      if (assignmentError) throw new Error("Caller-ID assignment could not be checked.");
      if (currentAssignment && currentAssignment.profile_id !== profileId) {
        return NextResponse.json({ error: "That caller ID is already assigned to another agent." }, { status: 409 });
      }
    }

    const { error } = await service.from("company_memberships").update({ crazytel_caller_id: callerId })
      .eq("profile_id", profileId)
      .eq("company_id", auth.session.companyId)
      .eq("role", "agent");
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That caller ID is already assigned to another agent." }, { status: 409 });
      throw new Error("Caller-ID assignment could not be saved.");
    }
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Caller-ID assignment could not be saved.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
