import { NextResponse } from "next/server";

import { STANDARD_AGENT_CONTACT_FIELDS, DEFAULT_AGENT_CONTACT_FIELDS } from "@/lib/agent-contact-fields";
import { createCompanyCrmClient } from "@/lib/company-database";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function loadOptions(companyId: string) {
  const { client: crm } = await createCompanyCrmClient(companyId);
  const { data, error } = await crm.from("contacts").select("custom_fields")
    .eq("company_id", companyId).order("updated_at", { ascending: false }).limit(500);
  if (error) throw new Error("CRM contact fields could not be loaded.");
  const customKeys = new Set<string>();
  for (const row of data ?? []) {
    const customFields = row.custom_fields && typeof row.custom_fields === "object" && !Array.isArray(row.custom_fields)
      ? row.custom_fields as Record<string, unknown>
      : {};
    for (const key of Object.keys(customFields)) {
      if (key.trim() && key.length <= 120 && !["__proto__", "constructor", "prototype"].includes(key)) customKeys.add(key);
    }
  }
  return [
    ...STANDARD_AGENT_CONTACT_FIELDS,
    ...[...customKeys].sort((left, right) => left.localeCompare(right)).map((key) => ({ id: `custom:${key}`, label: key })),
  ];
}

async function authorizeAgent(profileId: string, companyId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("company_memberships")
    .select("profile_id, agent_contact_fields")
    .eq("profile_id", profileId).eq("company_id", companyId).eq("role", "agent").maybeSingle();
  if (error) {
    if (error.message.includes("agent_contact_fields")) {
      throw new Error("Apply migration 20261019_000017_agent_contact_field_access.sql to the central Supabase database.");
    }
    throw new Error("Agent membership could not be verified.");
  }
  return data;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  try {
    const { id } = await params;
    const membership = await authorizeAgent(id, session.companyId);
    if (!membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    const fields = await loadOptions(session.companyId);
    return NextResponse.json({
      fields,
      visibleFields: Array.isArray(membership.agent_contact_fields) ? membership.agent_contact_fields : DEFAULT_AGENT_CONTACT_FIELDS,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("20261019_000017_agent_contact_field_access.sql")
      ? error.message
      : "Agent contact visibility settings could not be loaded.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Choose the fields this agent can see." }, { status: 400 });
  }
  const visibleFields = payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).visibleFields)
    ? (payload as { visibleFields: unknown[] }).visibleFields
    : null;
  if (!visibleFields || visibleFields.length > 50 || visibleFields.some((field) => typeof field !== "string")) {
    return NextResponse.json({ error: "Choose a valid list of contact fields." }, { status: 400 });
  }
  const normalized = [...new Set(visibleFields as string[])];
  try {
    const { id } = await params;
    const membership = await authorizeAgent(id, session.companyId);
    if (!membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    const options = await loadOptions(session.companyId);
    const allowed = new Set(options.map((field) => field.id));
    if (normalized.some((field) => !allowed.has(field))) return NextResponse.json({ error: "A selected field is no longer available in the CRM." }, { status: 400 });
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.from("company_memberships").update({ agent_contact_fields: normalized })
      .eq("profile_id", id).eq("company_id", session.companyId).eq("role", "agent");
    if (error) return NextResponse.json({ error: "Agent contact visibility settings could not be saved." }, { status: 503 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("20261019_000017_agent_contact_field_access.sql")
      ? error.message
      : "Agent contact visibility settings could not be saved.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
