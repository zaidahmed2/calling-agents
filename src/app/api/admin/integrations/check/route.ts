import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { listGhlContactsPage } from "@/lib/ghl";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const response = (state: "success" | "failure" | "blocked", message: string, status = 200) =>
  NextResponse.json({ state, message }, { status });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return response("failure", "Sign in is required to test integrations.", 401);
  if (session.role !== "admin") return response("failure", "Administrator access is required.", 403);

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
    if (!env.ghlPrivateIntegrationKey || !env.ghlLocationId) {
      return response("blocked", "Set GHL_PRIVATE_INTEGRATION_KEY and GHL_LOCATION_ID in the server environment first.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const result = await listGhlContactsPage({ limit: 1, signal: controller.signal });
      if (result.blocked) return response("failure", "The GHL request failed. Verify the key, account/location scope, and adapter endpoint configuration.");
      return response("success", "GHL accepted the contact-read request. No contact data was returned to this browser.");
    } catch {
      return response("failure", "The GHL connection check timed out or failed.");
    } finally {
      clearTimeout(timeout);
    }
  }

  if (provider === "crazytel") {
    if (!env.crazytelApiKey) return response("blocked", "Set CRAZYTEL_API_KEY in the server environment first.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const endpoint = new URL("/api/v1/balance/", env.crazytelApiBaseUrl);
      const result = await fetch(endpoint, {
        headers: { Accept: "application/json", "X-Crazytel-Api-Key": env.crazytelApiKey },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!result.ok) return response("failure", `Crazytel API key check failed with HTTP ${result.status}. No call was placed.`);
      return response("success", "Crazytel API key authenticated. No call was placed; browser WebRTC credentials are checked separately at call start.");
    } catch {
      return response("failure", "Could not reach the configured Crazytel API host. Verify CRAZYTEL_API_BASE_URL and network access.");
    } finally {
      clearTimeout(timeout);
    }
  }

  return response("failure", "Choose a supported integration to test.", 400);
}