import { NextResponse } from "next/server";

import { getCrazytelApiBaseUrl } from "@/lib/crazytel-api";
import { CRAZYTEL_OUTBOUND_URI_TEMPLATE, normalizeCrazytelSipUsername } from "@/lib/crazytel-utils";
import { getCompanyIntegration, saveCompanyCredentials } from "@/lib/integration-secrets";
import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid Crazytel assignment." }, { status: 400 }); }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const requestedAgentIds: unknown[] = Array.isArray(body.agentIds) ? body.agentIds : [];
  if (!requestedAgentIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "Select valid company agents." }, { status: 400 });
  }
  const agentIds = [...new Set(requestedAgentIds.filter((id): id is string => typeof id === "string"))];
  const trunkId = typeof body.trunkId === "string" ? body.trunkId : "";
  const username = typeof body.username === "string" ? normalizeCrazytelSipUsername(body.username) ?? "" : "";
  const manual = body.manual === true;
  const requestedPassword = typeof body.webrtcPassword === "string" ? body.webrtcPassword.trim() : "";
  if (!agentIds.length || agentIds.length !== requestedAgentIds.length || agentIds.length > 100 || agentIds.some((id) => !isUuid(id))
    || !isUuid(trunkId) || !username || requestedPassword.length > 512) {
    return NextResponse.json({ error: "Select one or more company agents and a valid Crazytel trunk." }, { status: 400 });
  }

  try {
    const service = createSupabaseServiceClient();
    const { data: memberships, error: membershipError } = await service.from("company_memberships")
      .select("profile_id")
      .eq("company_id", session.companyId)
      .eq("role", "agent")
      .in("profile_id", agentIds);
    if (membershipError) throw new Error("Company agents could not be verified.");
    if ((memberships ?? []).length !== agentIds.length) return NextResponse.json({ error: "An agent is not active in this company." }, { status: 400 });
    const { data: currentAssignments, error: assignmentError } = await service.from("company_memberships")
      .select("profile_id")
      .eq("company_id", session.companyId)
      .eq("role", "agent")
      .eq("crazytel_trunk_id", trunkId);
    if (assignmentError) throw new Error("Existing shared trunk assignments could not be loaded.");
    const removedAgentIds = (currentAssignments ?? [])
      .map((assignment) => assignment.profile_id)
      .filter((id) => !agentIds.includes(id));

    const { config, credentials } = await getCompanyIntegration(session.companyId, "crazytel");
    if (!config?.enabled || !credentials.apiKey) return NextResponse.json({ error: "Enable Crazytel and save its API key in Settings first." }, { status: 409 });
    const savedPassword = (currentAssignments ?? [])
      .map((assignment) => credentials[`agent-${assignment.profile_id}-webrtcPassword`])
      .find((value) => typeof value === "string" && value.trim());
    const password = requestedPassword || savedPassword || "";
    if (!password) {
      return NextResponse.json({ error: "This trunk has no saved WebRTC password. Add and verify its password before assigning agents." }, { status: 409 });
    }
    const baseUrl = typeof config.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io";

    let callerId: string;
    if (manual) {
      callerId = typeof body.callerId === "string" ? body.callerId.trim() : "";
    } else {
      const response = await fetch(new URL("/api/v1/sip-trunks/", getCrazytelApiBaseUrl(baseUrl)), {
        headers: { Accept: "application/json", "X-Crazytel-Api-Key": credentials.apiKey },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error("Crazytel trunk list could not be loaded.");
      const payload: unknown = await response.json();
      const trunks = Array.isArray(payload) ? payload : [];
      const selected = trunks.find((item) => {
        if (!item || typeof item !== "object") return false;
        const row = item as Record<string, unknown>;
        return row.id === trunkId && row.username === username && row.enabled === true;
      }) as Record<string, unknown> | undefined;
      if (!selected) return NextResponse.json({ error: "That enabled Crazytel trunk could not be verified for this account." }, { status: 400 });
      callerId = typeof selected.caller_id_number === "string" ? selected.caller_id_number : "";
    }

    const callerIdDigits = callerId.replace(/\D/g, "");
    if (callerIdDigits.length < 8 || callerIdDigits.length > 15) return NextResponse.json({ error: "Enter the caller ID configured on this Hybrid trunk." }, { status: 400 });
    const callerIdsResponse = await fetch(new URL("/api/v1/account/verified-cli/", getCrazytelApiBaseUrl(baseUrl)), {
      headers: { Accept: "application/json", "X-Crazytel-Api-Key": credentials.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!callerIdsResponse.ok) throw new Error("Crazytel verified caller IDs could not be loaded.");
    const callerIdsPayload: unknown = await callerIdsResponse.json();
    const verifiedCallerId = Array.isArray(callerIdsPayload)
      ? callerIdsPayload.find((item) => item && typeof item === "object"
        && typeof (item as Record<string, unknown>).number === "string"
        && ((item as Record<string, unknown>).number as string).replace(/\D/g, "") === callerIdDigits) as Record<string, unknown> | undefined
      : undefined;
    if (!verifiedCallerId || typeof verifiedCallerId.number !== "string") {
      return NextResponse.json({ error: "The caller ID must be verified and active on this Crazytel account." }, { status: 409 });
    }

    await saveCompanyCredentials(session.companyId, "crazytel", Object.fromEntries(
      agentIds.map((id) => [`agent-${id}-webrtcPassword`, password]),
    ));
    const { error: updateError } = await service.from("company_memberships").update({
      crazytel_trunk_id: trunkId,
      crazytel_trunk_username: username,
      crazytel_caller_id: verifiedCallerId.number,
      crazytel_outbound_uri_template: CRAZYTEL_OUTBOUND_URI_TEMPLATE,
    }).eq("company_id", session.companyId).eq("role", "agent").in("profile_id", agentIds);
    if (updateError) {
      if (updateError.code === "42703") return NextResponse.json({ error: "Apply Crazytel agent trunk migrations before assigning a trunk." }, { status: 503 });
      if (updateError.code === "23505") {
        console.error("Crazytel shared trunk assignment blocked by a database uniqueness constraint.", { code: updateError.code });
        return NextResponse.json({
          error: "The database still has a unique constraint preventing agents from sharing this trunk or caller ID. Run the updated 20261029_000027_allow_shared_crazytel_trunks.sql in the app's Supabase project, then retry.",
        }, { status: 409 });
      }
      console.error("Crazytel trunk assignment update failed.", { code: updateError.code, message: updateError.message });
      return NextResponse.json({
        error: `The database could not save the trunk assignment (error ${updateError.code || "unknown"}). Check that the app's Supabase project has the Crazytel trunk migrations applied.`,
      }, { status: 503 });
    }
    if (removedAgentIds.length) {
      const { error: removalError } = await service.from("company_memberships").update({
        crazytel_trunk_id: null,
        crazytel_trunk_username: null,
        crazytel_caller_id: null,
        crazytel_outbound_uri_template: null,
      }).eq("company_id", session.companyId).eq("role", "agent").in("profile_id", removedAgentIds);
      if (removalError) throw new Error("The new assignments were saved, but some previous agents could not be removed from this trunk. Refresh and retry.");
    }
    return NextResponse.json({ ok: true, assignedCount: agentIds.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hybrid trunk assignments could not be saved.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
