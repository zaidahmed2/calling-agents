import { NextResponse } from "next/server";

import { listActiveAgentProfiles } from "@/lib/assignable-agents";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { getLatestCallsByContact } from "@/lib/contact-history";
import { listCompanyContacts } from "@/lib/contacts";
import { createCompanyCrmClient } from "@/lib/company-database";

export const dynamic = "force-dynamic";

const mutationLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
const errorResponse = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse(401, "Sign in is required.");
  if (session.role !== "admin" || !session.companyId) return errorResponse(403, "Company administrator access is required.");
  const params = new URL(request.url).searchParams;
  const limitValue = Number(params.get("limit") ?? 25);
  const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 100) : 25;
  const requestedOffset = Number(params.get("offset") ?? params.get("startAfter") ?? 0);
  const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  try {
    const [page, agents] = await Promise.all([listCompanyContacts({ companyId: session.companyId, offset, limit }), listActiveAgentProfiles()]);
    const latestCalls = await getLatestCallsByContact(session.companyId, page.contacts.map((contact) => contact.id));
    return NextResponse.json({
      contacts: page.contacts.map((contact) => ({
        ...contact,
        lastCallAt: latestCalls[contact.id]?.lastCallAt ?? null,
        latestCallStatus: latestCalls[contact.id]?.latestCallStatus ?? "unknown",
      })),
      nextCursor: page.nextOffset === null ? null : { startAfter: String(page.nextOffset), startAfterId: "offset" },
      total: page.total,
      agents: agents.map((agent) => ({ id: agent.id, email: agent.email, ghlUserId: agent.id, name: agent.name })),
      statusFieldConfigured: true,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(503, "Company contacts could not be loaded.");
  }
}

function normalizeContact(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const firstName = typeof record.firstName === "string" ? record.firstName.trim() : name.split(/\s+/)[0] ?? "";
  const lastName = typeof record.lastName === "string" ? record.lastName.trim() : name.split(/\s+/).slice(1).join(" ");
  const phone = typeof record.phone === "string" ? record.phone.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const status = typeof record.status === "string" && record.status.trim() ? record.status.trim() : "open";
  const subject = typeof record.subject === "string" ? record.subject.trim() : "";
  const notes = typeof record.notes === "string" ? record.notes.trim() : "";
  const leadSource = typeof record.leadSource === "string" ? record.leadSource.trim() : "";
  const assignedAgentIds = Array.isArray(record.assignedAgentIds)
    ? [...new Set(record.assignedAgentIds.filter((value): value is string => typeof value === "string" && value.length > 0))]
    : typeof record.assignedAgentId === "string" && record.assignedAgentId ? [record.assignedAgentId] : [];
  const customFields = record.customFields && typeof record.customFields === "object" && !Array.isArray(record.customFields)
    ? record.customFields as Record<string, unknown>
    : {};
  if (!firstName && !lastName) return { error: "Contact name is required." };
  if (phone.length > 80 || email.length > 320 || status.length > 80 || subject.length > 500 || notes.length > 5000 || leadSource.length > 160) return { error: "One or more contact fields exceed the allowed length." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid contact email." };
  return { value: { first_name: firstName, last_name: lastName, phone: phone || null, email: email || null, status, subject: subject || null, notes: notes || null, lead_source: leadSource || null, assigned_agent_id: assignedAgentIds[0] ?? null, assigned_agent_ids: assignedAgentIds, custom_fields: customFields } };
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse(401, "Sign in is required.");
  if (session.role !== "admin" || !session.companyId) return errorResponse(403, "Company administrator access is required.");
  if (!isWithinRateLimit(mutationLimiter, session.id)) return errorResponse(429, "Too many contact changes. Wait a minute and try again.");
  let payload: unknown;
  try { payload = await request.json(); } catch { return errorResponse(400, "Invalid JSON request."); }

  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const isBatch = Array.isArray(body.contacts);
  const rows = isBatch ? body.contacts as unknown[] : [body];
  if (!rows.length || rows.length > 500) return errorResponse(400, "Import between 1 and 500 contacts per request.");
  const normalized = rows.map(normalizeContact);
  const invalidRows = normalized.flatMap((item, index) => item.error ? [{ row: index + 1, error: item.error }] : []);
  if (!isBatch && invalidRows.length) return errorResponse(400, invalidRows[0].error);
  const records = normalized.flatMap((item) => item.value ? [item.value] : []);
  const recordRows = normalized.flatMap((item, index) => item.value ? [index + 1] : []);
  if (!records.length) return body.preview === true
    ? NextResponse.json({ valid: 0, duplicates: [], invalidRows, total: rows.length })
    : NextResponse.json({ error: "No valid contact rows were found.", invalidRows }, { status: 400 });
  const assignmentIds = [...new Set(records.flatMap((item) => item.assigned_agent_ids))];
  if (assignmentIds.length) {
    const agents = await listActiveAgentProfiles();
    const allowed = new Set(agents.map((agent) => agent.id));
    if (assignmentIds.some((id) => !allowed.has(id))) return errorResponse(400, "An assigned agent is not active in this company.");
  }

  try {
    const { client: supabase } = await createCompanyCrmClient(session.companyId);
    const emails = [...new Set(records.flatMap((record) => record.email ? [record.email] : []))];
    const phones = [...new Set(records.flatMap((record) => record.phone ? [record.phone] : []))];
    const [emailResult, phoneResult] = await Promise.all([
      emails.length ? supabase.from("contacts").select("email").eq("company_id", session.companyId).in("email", emails) : Promise.resolve({ data: [], error: null }),
      phones.length ? supabase.from("contacts").select("phone").eq("company_id", session.companyId).in("phone", phones) : Promise.resolve({ data: [], error: null }),
    ]);
    if (emailResult.error || phoneResult.error) return errorResponse(503, "Duplicate checking could not be completed.");
    const existingEmails = new Set((emailResult.data ?? []).flatMap((item) => item.email ? [String(item.email).toLowerCase()] : []));
    const existingPhones = new Set((phoneResult.data ?? []).flatMap((item) => item.phone ? [String(item.phone).replace(/\D/g, "")] : []));
    const seenEmails = new Set<string>();
    const seenPhones = new Set<string>();
    const duplicateRecords = records.flatMap((record, index) => {
      const email = record.email?.toLowerCase() ?? "";
      const phone = record.phone?.replace(/\D/g, "") ?? "";
      const duplicateEmail = Boolean(email && (existingEmails.has(email) || seenEmails.has(email)));
      const duplicatePhone = Boolean(phone && (existingPhones.has(phone) || seenPhones.has(phone)));
      if (email) seenEmails.add(email);
      if (phone) seenPhones.add(phone);
      return duplicateEmail || duplicatePhone ? [{ index, row: recordRows[index], email: record.email, phone: record.phone, reason: duplicateEmail && duplicatePhone ? "Email and phone already exist" : duplicateEmail ? "Email already exists" : "Phone already exists" }] : [];
    });
    const duplicates = duplicateRecords.map((item) => ({ row: item.row, email: item.email, phone: item.phone, reason: item.reason }));
    if (body.preview === true) return NextResponse.json({ valid: records.length - duplicates.length, duplicates, invalidRows, total: rows.length });
    const duplicateIndexes = new Set(duplicateRecords.map((item) => item.index));
    const insertRecords = records.filter((_, index) => !duplicateIndexes.has(index));
    if (!insertRecords.length) return NextResponse.json({ imported: 0, skippedDuplicates: duplicates.length, invalidRows, duplicates });
    const { data, error } = await supabase.from("contacts").insert(insertRecords.map((record) => ({
      ...record,
      company_id: session.companyId,
      created_by: session.id,
    }))).select("id");
    if (error) return errorResponse(503, "Contact records could not be saved.");
    return NextResponse.json({ imported: data?.length ?? 0, skippedDuplicates: duplicates.length, invalidRows, duplicates, contacts: data ?? [] }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(503, "Contact records could not be saved.");
  }
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return errorResponse(401, "Sign in is required.");
  if (session.role !== "admin" || !session.companyId) return errorResponse(403, "Company administrator access is required.");
  if (!isWithinRateLimit(mutationLimiter, session.id)) return errorResponse(429, "Too many contact changes. Wait a minute and try again.");

  let payload: unknown;
  try { payload = await request.json(); } catch { return errorResponse(400, "Invalid JSON request."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return errorResponse(400, "Invalid contact update.");
  const body = payload as Record<string, unknown>;
  const contactIds = Array.isArray(body.contactIds) ? [...new Set(body.contactIds.filter((value): value is string => typeof value === "string" && value.length > 0))] : [];
  const hasAssignment = Object.hasOwn(body, "assignedAgentIds") || Object.hasOwn(body, "assignedTo");
  const assignedAgentIds = Array.isArray(body.assignedAgentIds)
    ? [...new Set(body.assignedAgentIds.filter((value): value is string => typeof value === "string" && value.length > 0))]
    : typeof body.assignedTo === "string" && body.assignedTo ? [body.assignedTo] : [];
  const status = body.status;
  if (contactIds.length === 0 || contactIds.length > 50) return errorResponse(400, "Select between 1 and 50 contacts.");
  if (!hasAssignment && status === undefined) return errorResponse(400, "Choose an assignment or status change.");
  if (hasAssignment && body.assignedAgentIds !== undefined && (!Array.isArray(body.assignedAgentIds) || body.assignedAgentIds.some((value) => typeof value !== "string"))) return errorResponse(400, "Invalid agent assignment.");
  if (assignedAgentIds.length > 100) return errorResponse(400, "Select no more than 100 agents for each contact.");
  if (status !== undefined && (typeof status !== "string" || !status.trim() || status.trim().length > 80)) return errorResponse(400, "Status must contain 1 to 80 characters.");

  if (hasAssignment && assignedAgentIds.length) {
    const agents = await listActiveAgentProfiles();
    const activeAgentIds = new Set(agents.map((agent) => agent.id));
    if (assignedAgentIds.some((id) => !activeAgentIds.has(id))) return errorResponse(400, "One or more selected agents are not active in this company.");
  }

  try {
    const { client: supabase, mode } = await createCompanyCrmClient(session.companyId);
    const args = mode === "shared"
      ? {
        p_contact_ids: contactIds,
        p_set_assignment: hasAssignment,
        p_assigned_agent_ids: assignedAgentIds,
        p_status: typeof status === "string" ? status.trim() : null,
      }
      : {
        p_company_id: session.companyId,
        p_contact_ids: contactIds,
        p_set_assignment: hasAssignment,
        p_assigned_agent_ids: assignedAgentIds,
        p_status: typeof status === "string" ? status.trim() : null,
        p_actor_id: session.id,
      };
    const { data, error } = await supabase.rpc("admin_assign_company_contacts", args);
    if (error) return errorResponse(error.message.includes("company_contact_not_found") ? 404 : 503, "One or more contacts could not be updated for this company.");
    return NextResponse.json({ results: contactIds.map((contactId) => ({ contactId, ok: true, message: "Updated in CRM." })), succeeded: Number(data ?? 0), failed: 0 });
  } catch {
    return errorResponse(503, "Contact changes could not be saved.");
  }
}