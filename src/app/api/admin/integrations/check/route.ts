import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCompanyIntegration } from "@/lib/integration-secrets";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { getCrazytelApiBaseUrl } from "@/lib/crazytel-api";

export const dynamic = "force-dynamic";

const response = (state: "success" | "failure" | "blocked", message: string, status = 200) =>
  NextResponse.json({ state, message }, { status });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return response("failure", "Sign in is required to test integrations.", 401);
  if (session.role !== "admin" || !session.companyId) return response("failure", "Company administrator access is required.", 403);

  let provider: unknown;
  try {
    ({ provider } = await request.json() as { provider?: unknown });
  } catch {
    return response("failure", "Invalid test request.", 400);
  }

  if (provider === "supabase") {
    try {
      const supabase = await createSupabaseServerClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || user?.id !== session.id) {
        return response("failure", "Supabase Auth session could not be verified.");
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", session.id)
        .maybeSingle();
      if (error || !data) return response("failure", "Auth succeeded, but the profile query failed. Check migrations and RLS.");
      return response("success", "Supabase Auth and the protected profile query both succeeded.");
    } catch {
      return response("failure", "Supabase is unreachable or its server configuration is incomplete.");
    }
  }

  if (provider === "ghl") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let state: "connected" | "failed" = "failed";
    let message = "The GHL connection check failed.";
    try {
      const { config, credentials } = await getCompanyIntegration(session.companyId, "ghl");
      const locationId = typeof config?.settings.locationId === "string" ? config.settings.locationId : "";
      if (!config?.enabled || !credentials.privateIntegrationKey || !locationId) return response("blocked", "Enable GHL and configure this company's private key and location ID first.");
      const endpoint = new URL("https://services.leadconnectorhq.com/contacts/");
      endpoint.searchParams.set("locationId", locationId);
      endpoint.searchParams.set("limit", "1");
      const result = await fetch(endpoint, { headers: { Accept: "application/json", Authorization: `Bearer ${credentials.privateIntegrationKey}`, Version: "v3" }, cache: "no-store", signal: controller.signal });
      if (!result.ok) message = `GHL rejected the company connection with HTTP ${result.status}.`;
      else { state = "connected"; message = "GHL accepted the company contact-read request. No contact data was returned to this browser."; }
    } catch {
      message = "The GHL connection check timed out or failed.";
    } finally {
      clearTimeout(timeout);
    }
    await createSupabaseServiceClient().from("company_integrations").update({ connection_status: state, last_error: state === "failed" ? message : null, last_checked_at: new Date().toISOString() }).eq("company_id", session.companyId).eq("provider", "ghl");
    return response(state === "connected" ? "success" : "failure", message);
  }

  if (provider === "crazytel") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    let state: "connected" | "failed" = "failed";
    let message = "Crazytel checks could not be completed.";
    const checks: Array<{ name: string; state: "success" | "failure" | "blocked"; message: string }> = [];
    try {
      const { config, credentials } = await getCompanyIntegration(session.companyId, "crazytel");
      const apiKey = credentials.apiKey ?? "";
      const baseUrl = getCrazytelApiBaseUrl(typeof config?.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io");
      if (!config?.enabled || !apiKey) return response("blocked", "Enable Crazytel and configure this company's API key first.");
      const headers = { Accept: "application/json", "X-Crazytel-Api-Key": apiKey };
      const requests = [
        { name: "API authentication and account balance", path: "/api/v1/balance/" },
        { name: "SIP trunk API", path: "/api/v1/sip-trunks/" },
        { name: "Hybrid call-recordings API", path: "/api/v1/hybrid-sip-trunks/siprec-recordings?limit=1" },
      ];
      const results = await Promise.all(requests.map(async ({ name, path }) => {
        try {
          const result = await fetch(new URL(path, baseUrl), { headers, cache: "no-store", signal: controller.signal });
          return { name, state: result.ok ? "success" as const : "failure" as const, message: result.ok ? `Available (HTTP ${result.status}).` : `Unavailable (HTTP ${result.status}).` };
        } catch {
          return { name, state: "failure" as const, message: "Request failed or timed out." };
        }
      }));
      checks.push(...results);
      const failed = checks.filter((check) => check.state === "failure");
      state = failed.length ? "failed" : "connected";
      message = failed.length
        ? `${failed.length} Crazytel API check(s) need attention. This does not test WebRTC registration or place a call.`
        : "Crazytel API, trunk list and recording endpoint responded. Add and test a Hybrid trunk below to enable browser calling.";
    } catch {
      message = "Could not load Crazytel settings or reach the configured API host.";
    } finally {
      clearTimeout(timeout);
    }
    await createSupabaseServiceClient().from("company_integrations").update({ connection_status: state, last_error: state === "failed" ? message : null, last_checked_at: new Date().toISOString() }).eq("company_id", session.companyId).eq("provider", "crazytel");
    return NextResponse.json({ state: state === "connected" ? "success" : "failure", message, checks });
  }

  return response("failure", "Choose a supported integration to test.", 400);
}