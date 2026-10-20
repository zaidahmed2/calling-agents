import { NextResponse } from "next/server";

import { getCompanyIntegration } from "@/lib/integration-secrets";
import { createCompanyCrmClient } from "@/lib/company-database";
import { getSession } from "@/lib/session";
import { getCrazytelApiBaseUrl } from "@/lib/crazytel-api";

export const dynamic = "force-dynamic";

type Recording = { call_uuid?: unknown; sip_call_id?: unknown };

function recordingRows(payload: unknown): Recording[] {
  if (Array.isArray(payload)) return payload.filter((row): row is Recording => Boolean(row && typeof row === "object"));
  if (payload && typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    const rows = Array.isArray(body.recordings) ? body.recordings
      : Array.isArray(body.data) ? body.data
        : Array.isArray(body.items) ? body.items
          : Array.isArray(body.results) ? body.results
            : [];
    return rows.filter((row): row is Recording => Boolean(row && typeof row === "object"));
  }
  return [];
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (!session.companyId || !["admin", "agent"].includes(session.role)) return NextResponse.json({ error: "Call recording access is not available." }, { status: 403 });

  const { id } = await params;
  try {
    const { client: crm } = await createCompanyCrmClient(session.companyId);
    let callQuery = crm.from("calls").select("id, agent_id, provider_call_id").eq("id", id).eq("company_id", session.companyId);
    if (session.role === "agent") callQuery = callQuery.eq("agent_id", session.id);
    const { data: call, error: callError } = await callQuery.maybeSingle();
    if (callError || !call) return NextResponse.json({ error: "This call is not available." }, { status: 404 });
    if (!call.provider_call_id) return NextResponse.json({ available: false }, { headers: { "Cache-Control": "no-store" } });

    const { config, credentials } = await getCompanyIntegration(session.companyId, "crazytel");
    if (!config?.enabled || !credentials.apiKey) return NextResponse.json({ error: "Crazytel recording access is not configured." }, { status: 503 });
    const baseUrl = getCrazytelApiBaseUrl(typeof config.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io");

    const endpoint = new URL("/api/v1/hybrid-sip-trunks/siprec-recordings", baseUrl);
    endpoint.searchParams.set("sip_call_id", call.provider_call_id);
    endpoint.searchParams.set("limit", "10");
    const recordingsResponse = await fetch(endpoint, {
      headers: { Accept: "application/json", "X-Crazytel-Api-Key": credentials.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!recordingsResponse.ok) return NextResponse.json({ error: `Crazytel recording list failed (HTTP ${recordingsResponse.status}).` }, { status: 502 });
    const rows = recordingRows(await recordingsResponse.json());
    const match = rows.find((row) => row.sip_call_id === call.provider_call_id && typeof row.call_uuid === "string");
    if (!match || typeof match.call_uuid !== "string") return NextResponse.json({ available: false }, { headers: { "Cache-Control": "no-store" } });

    if (new URL(request.url).searchParams.get("stream") !== "1") {
      return NextResponse.json({ available: true, streamUrl: `/api/calls/${encodeURIComponent(id)}/recording?stream=1` }, { headers: { "Cache-Control": "no-store" } });
    }

    const streamUrl = new URL(`/api/v1/hybrid-sip-trunks/siprec-recordings/${encodeURIComponent(match.call_uuid)}/stream`, baseUrl);
    const providerResponse = await fetch(streamUrl, {
      headers: { "X-Crazytel-Api-Key": credentials.apiKey },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const location = providerResponse.headers.get("location");
    if (providerResponse.status >= 300 && providerResponse.status < 400 && location) {
      const signedUrl = new URL(location, streamUrl);
      if (signedUrl.protocol !== "https:") return NextResponse.json({ error: "Crazytel returned an insecure recording link." }, { status: 502 });
      return NextResponse.redirect(signedUrl, 302);
    }
    if (!providerResponse.ok || !providerResponse.body) {
      return NextResponse.json({ error: `Crazytel recording stream failed (HTTP ${providerResponse.status}).` }, { status: 502 });
    }
    return new Response(providerResponse.body, {
      headers: {
        "Content-Type": providerResponse.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Call recording could not be loaded. Verify Crazytel recording access and the database migration." }, { status: 503 });
  }
}
