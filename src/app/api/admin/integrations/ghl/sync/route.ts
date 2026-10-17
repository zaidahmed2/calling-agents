import { NextResponse } from "next/server";

import { getCompanyIntegration } from "@/lib/integration-secrets";
import { extractGhlContacts, extractGhlPagination } from "@/lib/ghl-contact-data";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

type Mapping = { internal_field: string; external_field_id: string; sync_direction: string };

function fieldValue(contact: Record<string, unknown>, fieldId: string): string {
  const standard: Record<string, string> = { "standard:firstName": "firstName", "standard:lastName": "lastName", "standard:phone": "phone", "standard:email": "email" };
  if (standard[fieldId]) {
    const value = contact[standard[fieldId]];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
  const values = Array.isArray(contact.customFields) ? contact.customFields as Array<Record<string, unknown>> : [];
  const field = values.find((item) => item.id === fieldId);
  const value = field?.value ?? field?.fieldValue;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function customValue(contact: Record<string, unknown>, mappings: Mapping[], internalField: string): string | undefined {
  const mapping = mappings.find((item) => item.internal_field === internalField && ["import", "both"].includes(item.sync_direction));
  return mapping ? fieldValue(contact, mapping.external_field_id) : undefined;
}

async function fetchRemoteContacts(token: string, locationId: string, maxContacts: number) {
  const all: Record<string, unknown>[] = [];
  let cursor: { startAfter: string | null; startAfterId: string | null } | null = null;
  for (let pageNumber = 0; pageNumber < 100 && all.length < maxContacts; pageNumber += 1) {
    const endpoint = new URL("https://services.leadconnectorhq.com/contacts/");
    endpoint.searchParams.set("locationId", locationId);
    endpoint.searchParams.set("limit", String(Math.min(100, maxContacts - all.length)));
    if (cursor?.startAfter) endpoint.searchParams.set("startAfter", cursor.startAfter);
    if (cursor?.startAfterId) endpoint.searchParams.set("startAfterId", cursor.startAfterId);
    const response = await fetch(endpoint, { headers: { Accept: "application/json", Authorization: `Bearer ${token}`, Version: "v3" }, cache: "no-store" });
    if (!response.ok) throw new Error(`GHL contact request failed with HTTP ${response.status}.`);
    const payload: unknown = await response.json();
    all.push(...extractGhlContacts(payload));
    cursor = extractGhlPagination(payload);
    if (!cursor.startAfter || !cursor.startAfterId || !extractGhlContacts(payload).length) break;
  }
  return all.slice(0, maxContacts);
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid synchronization request." }, { status: 400 }); }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (body.action !== "import" && body.action !== "export") return NextResponse.json({ error: "Choose import or export." }, { status: 400 });
  const operation = body.action;
  const requestedLimit = Number(body.limit ?? 100);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 1000) : 100;
  const supabase = await createSupabaseServerClient();
  const service = createSupabaseServiceClient();
  let runId = "";

  try {
    const { data: run, error: runError } = await service.from("company_sync_runs").insert({ company_id: session.companyId, provider: "ghl", operation, state: "running" }).select("id").single();
    if (runError || !run) return NextResponse.json({ error: "The synchronization run could not be recorded." }, { status: 503 });
    runId = run.id;
    const { config, credentials } = await getCompanyIntegration(session.companyId, "ghl");
    const locationId = typeof config?.settings.locationId === "string" ? config.settings.locationId.trim() : "";
    const token = credentials.privateIntegrationKey ?? "";
    if (!config?.enabled || !token || !locationId) throw new Error("Enable GHL and configure the private integration key and location ID first.");
    if (operation === "import" && config.settings.importEnabled !== true) throw new Error("Enable manual GHL import in company settings first.");
    if (operation === "export" && config.settings.exportEnabled !== true) throw new Error("Enable manual GHL export in company settings first.");
    const { data: mappings, error: mappingError } = await supabase.from("company_field_mappings")
      .select("internal_field, external_field_id, sync_direction").eq("company_id", session.companyId).eq("provider", "ghl");
    if (mappingError) throw new Error("GHL field mappings could not be loaded.");
    const fieldMappings = (mappings ?? []) as Mapping[];
    let imported = 0;
    let exported = 0;
    let skipped = 0;
    let failed = 0;

    if (operation === "import") {
      const remote = await fetchRemoteContacts(token, locationId, limit);
      const records = remote.flatMap((contact) => {
        const id = typeof contact.id === "string" ? contact.id : "";
        if (!id) return [];
        const firstName = typeof contact.firstName === "string" ? contact.firstName.trim() : "";
        const lastName = typeof contact.lastName === "string" ? contact.lastName.trim() : "";
        if (!firstName && !lastName) { skipped += 1; return []; }
        const value = (key: string, fallback: unknown) => customValue(contact, fieldMappings, key) ?? (typeof fallback === "string" ? fallback : "");
        return [{
          company_id: session.companyId,
          first_name: value("first_name", firstName),
          last_name: value("last_name", lastName),
          phone: value("phone", contact.phone) || null,
          email: value("email", contact.email).toLowerCase() || null,
          status: value("status", "open") || "open",
          subject: value("subject", contact.subject) || null,
          notes: value("notes", "") || null,
          lead_source: value("lead_source", contact.source) || null,
          custom_fields: {},
          external_provider: "ghl",
          external_contact_id: id,
          created_by: session.id,
        }];
      });
      const { data, error } = records.length ? await service.from("contacts").upsert(records, { onConflict: "company_id,external_provider,external_contact_id", ignoreDuplicates: true }).select("id") : { data: [], error: null };
      if (error) throw new Error("GHL contacts could not be imported.");
      imported = data?.length ?? 0;
      skipped += records.length - imported;
    } else {
      const { data: contacts, error } = await supabase.from("contacts")
        .select("id, first_name, last_name, phone, email, status, subject, notes, lead_source, external_contact_id")
        .eq("company_id", session.companyId).limit(limit);
      if (error) throw new Error("Company contacts could not be loaded for export.");
      const exportMappings = fieldMappings.filter((item) => ["export", "both"].includes(item.sync_direction));
      if (!exportMappings.some((item) => item.internal_field === "first_name")) throw new Error("Map the CRM first-name field to GHL before exporting.");
      const standard: Record<string, keyof NonNullable<typeof contacts>[number]> = { first_name: "first_name", last_name: "last_name", phone: "phone", email: "email" };
      for (const contact of contacts ?? []) {
        if (contact.external_contact_id && config.settings.exportUpdateExisting !== true) { skipped += 1; continue; }
        const customFields = exportMappings.flatMap((mapping) => {
          if (mapping.internal_field in standard) return [];
          const value = contact[mapping.internal_field as keyof typeof contact];
          return value === null || value === undefined || value === "" ? [] : [{ id: mapping.external_field_id, fieldValue: String(value) }];
        });
        const remoteContact: Record<string, unknown> = { locationId, customFields };
        for (const mapping of exportMappings) {
          const field = standard[mapping.internal_field];
          const remoteKey = ({ first_name: "firstName", last_name: "lastName", phone: "phone", email: "email" } as Record<string, string>)[mapping.internal_field];
          if (field && remoteKey) remoteContact[remoteKey] = contact[field] ?? undefined;
        }
        const endpoint = contact.external_contact_id
          ? `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contact.external_contact_id)}`
          : "https://services.leadconnectorhq.com/contacts/";
        const response = await fetch(endpoint, {
          method: contact.external_contact_id ? "PUT" : "POST",
          headers: { Accept: "application/json", Authorization: `Bearer ${token}`, Version: "v3", "Content-Type": "application/json" },
          body: JSON.stringify(remoteContact),
          cache: "no-store",
        });
        if (!response.ok) { failed += 1; continue; }
        const payloadResult: unknown = await response.json().catch(() => ({}));
        const root = payloadResult && typeof payloadResult === "object" ? payloadResult as Record<string, unknown> : {};
        const data = root.contact && typeof root.contact === "object" ? root.contact as Record<string, unknown> : root;
        const remoteId = typeof data.id === "string" ? data.id : contact.external_contact_id;
        if (!remoteId) { failed += 1; continue; }
        const { error: updateError } = await service.from("contacts").update({ external_provider: "ghl", external_contact_id: remoteId })
          .eq("id", contact.id).eq("company_id", session.companyId);
        if (updateError) failed += 1;
        else exported += 1;
      }
    }

    const state = failed ? (imported || exported ? "partial" : "failed") : "completed";
    await service.from("company_sync_runs").update({ state, imported_count: imported, exported_count: exported, skipped_count: skipped, failed_count: failed, finished_at: new Date().toISOString() }).eq("id", runId);
    return NextResponse.json({ imported, exported, skipped, failed, runId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (runId) await service.from("company_sync_runs").update({ state: "failed", failed_count: 1, details: { error: error instanceof Error ? error.message : "unknown" }, finished_at: new Date().toISOString() }).eq("id", runId);
    return NextResponse.json({ error: error instanceof Error ? error.message : "GHL synchronization failed." }, { status: 502 });
  }
}
