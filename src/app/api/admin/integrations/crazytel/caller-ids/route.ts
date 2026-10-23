import { NextResponse } from "next/server";

import { listCompanyAgentProfiles } from "@/lib/assignable-agents";
import { getCrazytelApiBaseUrl } from "@/lib/crazytel-api";
import { getCompanyIntegration } from "@/lib/integration-secrets";
import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

type VerifiedCallerId = { id: string; number: string; nickname: string | null; domain: string | null };
type CrazytelTrunk = { id: string; username: string; enabled: boolean; callerIdNumber: string | null; description: string | null; manual?: boolean };

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
    if (typeof row.id !== "string" || typeof row.username !== "string" || typeof row.enabled !== "boolean") return [];
    return [{
      id: row.id,
      username: row.username,
      enabled: row.enabled,
      callerIdNumber: typeof row.caller_id_number === "string" ? row.caller_id_number : null,
      description: typeof row.description === "string" ? row.description : null,
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
        .select("profile_id, crazytel_caller_id, crazytel_trunk_username, crazytel_trunk_id, crazytel_outbound_uri_template")
        .eq("company_id", auth.session.companyId)
        .eq("role", "agent"),
    ]);
    if (assignments.error) {
      if (assignments.error.code === "42703") throw new Error("Apply migrations 20261022_000022_agent_crazytel_caller_ids.sql and 20261023_000023_agent_crazytel_outbound_uri.sql and try again.");
      throw new Error("Crazytel caller-ID assignments could not be loaded.");
    }
    const assignmentRows = assignments.data ?? [];
    const assignedIds = new Map(assignmentRows.map((row) => [row.profile_id, {
      callerId: row.crazytel_caller_id,
      trunkUsername: row.crazytel_trunk_username,
      trunkId: row.crazytel_trunk_id,
      outboundUriTemplate: row.crazytel_outbound_uri_template,
    }]));
    const providerTrunkIds = new Set(trunks.map((trunk) => trunk.id));
    const manualTrunks = assignmentRows.flatMap((row): CrazytelTrunk[] => {
      if (!row.crazytel_trunk_id || !row.crazytel_trunk_username || providerTrunkIds.has(row.crazytel_trunk_id)) return [];
      return [{
        id: row.crazytel_trunk_id,
        username: row.crazytel_trunk_username,
        enabled: true,
        callerIdNumber: row.crazytel_caller_id,
        description: "Manually added Hybrid trunk",
        manual: true,
      }];
    });
    return NextResponse.json({
      callerIds,
      trunks: [...trunks, ...manualTrunks],
      agents: agents.map((agent) => {
        const assignment = assignedIds.get(agent.id);
        return {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          callerId: assignment?.callerId ?? null,
          trunkId: assignment?.trunkId ?? null,
          trunkUsername: assignment?.trunkUsername ?? null,
          outboundUriTemplate: assignment?.outboundUriTemplate ?? null,
          trunkCallerId: assignment?.trunkUsername ? trunks.find((trunk) => trunk.username === assignment.trunkUsername)?.callerIdNumber ?? null : null,
        };
      }),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Crazytel caller IDs could not be loaded.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function PATCH() {
  return NextResponse.json({
    error: "Assign a verified caller ID by assigning its configured Crazytel trunk to the agent.",
  }, { status: 405 });
}
