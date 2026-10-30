import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { saveCompanyCredentials, type IntegrationProvider } from "@/lib/integration-secrets";

export const dynamic = "force-dynamic";

function isProvider(value: unknown): value is IntegrationProvider {
  return value === "ghl" || value === "crazytel" || value === "gemini";
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  try {
    const supabase = await createSupabaseServerClient();
    const [{ data: integrations, error }, { data: mappings, error: mappingError }, { data: fields, error: fieldError }, { data: syncRuns, error: syncError }] = await Promise.all([
      supabase.from("company_integrations").select("provider, enabled, settings, connection_status, last_error, last_checked_at")
        .eq("company_id", session.companyId),
      supabase.from("company_field_mappings").select("internal_field, external_field_id, external_field_name, external_field_type, sync_direction")
        .eq("company_id", session.companyId).eq("provider", "ghl"),
      supabase.from("company_external_fields").select("external_field_id, name, field_type, available, refreshed_at")
        .eq("company_id", session.companyId).eq("provider", "ghl").order("name"),
      supabase.from("company_sync_runs").select("id, operation, state, imported_count, exported_count, skipped_count, failed_count, started_at, finished_at, details")
        .eq("company_id", session.companyId).eq("provider", "ghl").order("started_at", { ascending: false }).limit(20),
    ]);
    if (error || mappingError || fieldError || syncError) return NextResponse.json({ error: "Company integration settings could not be loaded." }, { status: 503 });
    const results = { ghl: null as unknown, crazytel: null as unknown };
    for (const integration of integrations ?? []) {
      const provider = integration.provider as IntegrationProvider;
      if (provider === "gemini") continue;
      const settings = integration.settings && typeof integration.settings === "object" ? integration.settings as Record<string, unknown> : {};
      results[provider] = {
        enabled: integration.enabled,
        connectionStatus: integration.connection_status,
        lastError: integration.last_error,
        lastCheckedAt: integration.last_checked_at,
        settings,
      };
    }
    const { data: secretRows, error: secretError } = await createSupabaseServiceClient().from("company_integration_secrets")
      .select("provider").eq("company_id", session.companyId);
    if (secretError) return NextResponse.json({ error: "Company integration credentials could not be checked." }, { status: 503 });
    return NextResponse.json({
      integrations: results,
      hasCredentials: Object.fromEntries((secretRows ?? []).map((item) => [item.provider, true])),
      mappings: mappings ?? [],
      fields: fields ?? [],
      syncRuns: syncRuns ?? [],
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Company integration settings could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid integration settings." }, { status: 400 }); }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (!isProvider(body.provider)) return NextResponse.json({ error: "Choose a supported integration." }, { status: 400 });
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "Choose whether the integration is enabled." }, { status: 400 });
  const credentials = body.credentials && typeof body.credentials === "object" && !Array.isArray(body.credentials)
    ? Object.fromEntries(Object.entries(body.credentials as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  const settings = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
    ? body.settings as Record<string, unknown>
    : {};
  if (Object.values(settings).some((value) => typeof value === "string" && value.length > 1000)) return NextResponse.json({ error: "An integration setting exceeds the allowed length." }, { status: 400 });

  try {
    if (body.provider === "gemini") {
      const apiKey = credentials.apiKey?.trim() ?? "";
      if (!apiKey || apiKey.length > 500) return NextResponse.json({ error: "Enter a valid Gemini API key of up to 500 characters." }, { status: 400 });
      await saveCompanyCredentials(session.companyId, "gemini", { apiKey });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (Object.values(credentials).some((value) => value.trim())) await saveCompanyCredentials(session.companyId, body.provider, credentials);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("company_integrations").upsert({
      company_id: session.companyId,
      provider: body.provider,
      enabled: body.enabled,
      settings,
      connection_status: body.enabled ? "not_configured" : "disabled",
      last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,provider" });
    if (error) return NextResponse.json({ error: "Integration settings could not be saved." }, { status: 503 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (saveError) {
    const message = saveError instanceof Error && saveError.message.includes("INTEGRATION_ENCRYPTION_KEY")
      ? "Set a valid server-side INTEGRATION_ENCRYPTION_KEY before saving integration credentials."
      : "Integration settings could not be saved.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid integration disconnect request." }, { status: 400 }); }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (!isProvider(body.provider)) return NextResponse.json({ error: "Choose a supported integration." }, { status: 400 });
  try {
    const service = createSupabaseServiceClient();
    const [{ error: configError }, { error: secretError }] = await Promise.all([
      service.from("company_integrations").update({ enabled: false, connection_status: "disabled", last_error: null, last_checked_at: new Date().toISOString() })
        .eq("company_id", session.companyId).eq("provider", body.provider),
      service.from("company_integration_secrets").delete().eq("company_id", session.companyId).eq("provider", body.provider),
    ]);
    if (configError || secretError) return NextResponse.json({ error: "Integration could not be disconnected." }, { status: 503 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Integration could not be disconnected." }, { status: 503 });
  }
}
