import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCompanyIntegration } from "@/lib/integration-secrets";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

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
    let message = "The Crazytel API key check failed.";
    try {
      const { config, credentials } = await getCompanyIntegration(session.companyId, "crazytel");
      const apiKey = credentials.apiKey ?? "";
      const baseUrl = typeof config?.settings.apiBaseUrl === "string" ? config.settings.apiBaseUrl : "https://api.crazytel.io";
      if (!config?.enabled || !apiKey) return response("blocked", "Enable Crazytel and configure this company's API key first.");
      const endpoint = new URL("/api/v1/balance/", baseUrl);
      const result = await fetch(endpoint, {
        headers: { Accept: "application/json", "X-Crazytel-Api-Key": apiKey },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!result.ok) message = `Crazytel API key check failed with HTTP ${result.status}. No call was placed.`;
      else { state = "connected"; message = "Crazytel API key authenticated. No call was placed; browser WebRTC credentials are checked at call start."; }
    } catch {
      message = "Could not reach the configured Crazytel API host. Verify its company settings and network access.";
    } finally {
      clearTimeout(timeout);
    }
    await createSupabaseServiceClient().from("company_integrations").update({ connection_status: state, last_error: state === "failed" ? message : null, last_checked_at: new Date().toISOString() }).eq("company_id", session.companyId).eq("provider", "crazytel");
    return response(state === "connected" ? "success" : "failure", message);
  }

  return response("failure", "Choose a supported integration to test.", 400);
}