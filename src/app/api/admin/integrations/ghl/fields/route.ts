import { NextResponse } from "next/server";

import { getCompanyIntegration } from "@/lib/integration-secrets";
import { parseGhlCustomFields } from "@/lib/ghl-fields";
import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  try {
    const { config, credentials } = await getCompanyIntegration(session.companyId, "ghl");
    const locationId = typeof config?.settings.locationId === "string" ? config.settings.locationId.trim() : "";
    const token = credentials.privateIntegrationKey ?? "";
    if (!config?.enabled || !token || !locationId) return NextResponse.json({ error: "Enable GHL and configure the private integration key and location ID first." }, { status: 409 });
    const endpoint = new URL(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}/customFields`);
    endpoint.searchParams.set("model", "contact");
    const response = await fetch(endpoint, { headers: { Accept: "application/json", Authorization: `Bearer ${token}`, Version: "v3" }, cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      return NextResponse.json({ error: "GHL rejected the private integration key or it lacks permission to read contact fields. Check the key and its scopes." }, { status: 502 });
    }
    if (response.status === 404) {
      return NextResponse.json({ error: "GHL could not find this location. Check the Location ID." }, { status: 502 });
    }
    if (response.status === 429) {
      return NextResponse.json({ error: "GHL is temporarily rate-limiting field requests. Wait a moment and retry." }, { status: 502 });
    }
    if (!response.ok) return NextResponse.json({ error: `GHL field discovery failed with HTTP ${response.status}.` }, { status: 502 });
    const payload: unknown = await response.json();
    const parsedFields = parseGhlCustomFields(payload);
    if (!parsedFields.recognized) {
      return NextResponse.json({ error: "GHL returned an unexpected contact-field response. Cached fields were not changed; retry or check the GHL integration." }, { status: 502 });
    }
    const standardFields = [
      { id: "standard:firstName", name: "First name", type: "TEXT", metadata: { standard: true } },
      { id: "standard:lastName", name: "Last name", type: "TEXT", metadata: { standard: true } },
      { id: "standard:phone", name: "Phone", type: "PHONE", metadata: { standard: true } },
      { id: "standard:email", name: "Email", type: "EMAIL", metadata: { standard: true } },
    ];
    const normalized = [...new Map([...standardFields, ...parsedFields.fields].map((field) => [field.id, field])).values()];
    const service = createSupabaseServiceClient();
    const { error: upsertError } = normalized.length ? await service.from("company_external_fields").upsert(normalized.map((field) => ({
      company_id: session.companyId!, provider: "ghl", external_field_id: field.id, name: field.name,
      field_type: field.type, metadata: field.metadata, available: true, refreshed_at: new Date().toISOString(),
    })), { onConflict: "company_id,provider,external_field_id" }) : { error: null };
    if (upsertError) return NextResponse.json({ error: "GHL fields were retrieved but could not be saved." }, { status: 503 });
    const availableIds = normalized.map((field) => field.id);
    const { data: cachedFields, error: cachedError } = await service.from("company_external_fields")
      .select("external_field_id").eq("company_id", session.companyId).eq("provider", "ghl");
    if (cachedError) return NextResponse.json({ error: "GHL fields were loaded, but cached metadata could not be checked." }, { status: 503 });
    const staleIds = (cachedFields ?? []).map((field) => field.external_field_id).filter((id) => !availableIds.includes(id));
    const { error: staleError } = staleIds.length ? await service.from("company_external_fields")
      .update({ available: false, refreshed_at: new Date().toISOString() })
      .eq("company_id", session.companyId).eq("provider", "ghl").in("external_field_id", staleIds) : { error: null };
    if (staleError) return NextResponse.json({ error: "GHL fields were loaded, but unavailable fields could not be marked." }, { status: 503 });
    return NextResponse.json({ fields: normalized.map(({ id, name, type }) => ({ id, name, type })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("INTEGRATION_ENCRYPTION_KEY")
      ? "Set a valid server-side INTEGRATION_ENCRYPTION_KEY before connecting GHL."
      : "GHL field discovery could not be completed.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
