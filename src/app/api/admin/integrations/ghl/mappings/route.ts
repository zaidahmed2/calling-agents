import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const internalFields = new Set(["first_name", "last_name", "phone", "email", "status", "subject", "notes", "lead_source"]);

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid field mappings." }, { status: 400 }); }
  const mappings = payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).mappings)
    ? (payload as { mappings: unknown[] }).mappings
    : null;
  if (!mappings || mappings.length > 50) return NextResponse.json({ error: "Provide up to 50 field mappings." }, { status: 400 });
  const normalized = mappings.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.internalField !== "string" || typeof record.externalFieldId !== "string") return [];
    const direction = record.syncDirection;
    if (!internalFields.has(record.internalField) || !["import", "export", "both", "disabled"].includes(String(direction))) return [];
    return [{ internal_field: record.internalField, external_field_id: record.externalFieldId, sync_direction: direction as string }];
  });
  if (normalized.length !== mappings.length) return NextResponse.json({ error: "A mapping contains an unsupported field or direction." }, { status: 400 });
  if (new Set(normalized.map((item) => item.internal_field)).size !== normalized.length || new Set(normalized.map((item) => item.external_field_id)).size !== normalized.length) {
    return NextResponse.json({ error: "Each internal and external field can only be mapped once." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const ids = [...new Set(normalized.map((item) => item.external_field_id))];
  const customIds = ids.filter((id) => !id.startsWith("standard:"));
  const { data: fields, error: fieldError } = customIds.length
    ? await supabase.from("company_external_fields").select("external_field_id, name, field_type").eq("company_id", session.companyId).eq("provider", "ghl").eq("available", true).in("external_field_id", customIds)
    : { data: [], error: null };
  if (fieldError || (fields?.length ?? 0) !== customIds.length) return NextResponse.json({ error: "Refresh GHL fields and choose currently available fields." }, { status: 409 });
  const standardNames: Record<string, string> = { "standard:firstName": "First name", "standard:lastName": "Last name", "standard:phone": "Phone", "standard:email": "Email" };
  const fieldsById = new Map([
    ...(fields ?? []).map((field) => [field.external_field_id, field] as const),
    ...ids.filter((id) => id.startsWith("standard:") && standardNames[id]).map((id) => [id, { external_field_id: id, name: standardNames[id], field_type: null }] as const),
  ]);
  const compatible = normalized.every((mapping) => {
    const type = String(fieldsById.get(mapping.external_field_id)?.field_type ?? "").toLowerCase();
    if (!type) return true;
    if (mapping.internal_field === "email") return type.includes("email") || type.includes("text");
    if (mapping.internal_field === "phone") return type.includes("phone") || type.includes("tel") || type.includes("text");
    return type.includes("text") || type.includes("string") || type.includes("single") || type.includes("multi") || type.includes("date");
  });
  if (!compatible) return NextResponse.json({ error: "A GHL field type is incompatible with its selected CRM field." }, { status: 400 });
  const { error: deleteError } = await supabase.from("company_field_mappings").delete().eq("company_id", session.companyId).eq("provider", "ghl");
  if (deleteError) return NextResponse.json({ error: "Existing field mappings could not be replaced." }, { status: 503 });
  const { error } = normalized.length ? await supabase.from("company_field_mappings").insert(normalized.map((mapping) => {
    const field = fieldsById.get(mapping.external_field_id)!;
    return {
      company_id: session.companyId,
      provider: "ghl",
      internal_field: mapping.internal_field,
      external_field_id: mapping.external_field_id,
      external_field_name: field.name,
      external_field_type: field.field_type,
      sync_direction: mapping.sync_direction,
    };
  })) : { error: null };
  if (error) return NextResponse.json({ error: "Field mappings could not be saved." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
