import type { GhlContact } from "@/lib/ghl-contact-data";
import { toAgentContact } from "@/lib/ghl-contact-data";
import { createCompanyCrmClient } from "@/lib/company-database";
import { getAgentContactFields } from "@/lib/agent-contact-fields";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

type ContactRow = {
  id: string;
  company_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  status: string;
  subject: string | null;
  notes: string | null;
  lead_source: string | null;
  assigned_agent_id: string | null;
  custom_fields: Record<string, unknown>;
  updated_at: string;
};

export type CrmContact = GhlContact & {
  notes: string | null;
  leadSource: string | null;
  assignedAgentId: string | null;
  customFields: Record<string, unknown>;
};

function maskPhone(value: string | null): string {
  if (!value) return "•••• ••••";
  const digits = (value.match(/\d/g) ?? []).length;
  return digits <= 4 ? value.replace(/\d/g, "•") : value.replace(/\d(?=\d{4})/g, "•");
}

export function toCrmContact(row: ContactRow): CrmContact {
  const suburbValue = row.custom_fields?.suburb;
  return {
    id: row.id,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed contact",
    email: row.email ?? undefined,
    suburb: typeof suburbValue === "string" ? suburbValue : null,
    subject: row.subject ?? undefined,
    status: row.status,
    assignedUserId: row.assigned_agent_id,
    isOpen: row.status.trim().toLowerCase() === "open",
    phone: row.phone,
    maskedPhone: maskPhone(row.phone),
    lastActivityAt: row.updated_at,
    notes: row.notes,
    leadSource: row.lead_source,
    assignedAgentId: row.assigned_agent_id,
    customFields: row.custom_fields ?? {},
  };
}

export async function listCompanyContacts({ companyId, offset = 0, limit = 25 }: { companyId: string; offset?: number; limit?: number }) {
  const { client: supabase } = await createCompanyCrmClient(companyId);
  const start = Math.max(0, offset);
  const size = Math.min(Math.max(limit, 1), 100);
  const { data, error, count } = await supabase.from("contacts")
    .select("id, company_id, first_name, last_name, phone, email, status, subject, notes, lead_source, assigned_agent_id, custom_fields, updated_at", { count: "exact" })
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .range(start, start + size - 1);
  if (error) throw new Error("Company contacts could not be loaded.");
  const rows = (data ?? []) as ContactRow[];
  return {
    contacts: rows.map(toCrmContact),
    total: count ?? 0,
    nextOffset: start + rows.length < (count ?? 0) ? start + rows.length : null,
  };
}

export async function getCompanyContact(contactId: string, companyId: string): Promise<CrmContact | null> {
  if (!contactId || !companyId) return null;
  const { client: supabase } = await createCompanyCrmClient(companyId);
  const { data, error } = await supabase.from("contacts")
    .select("id, company_id, first_name, last_name, phone, email, status, subject, notes, lead_source, assigned_agent_id, custom_fields, updated_at")
    .eq("id", contactId)
    .eq("company_id", companyId)
    .maybeSingle();
  return error || !data ? null : toCrmContact(data as ContactRow);
}

export async function getOpenContactForAgent(contactId: string, companyId: string, agentId: string): Promise<GhlContact | null> {
  if (!contactId || !companyId || !agentId) return null;
  const { client: supabase } = await createCompanyCrmClient(companyId);
  const { data, error } = await supabase.from("contacts")
    .select("id, company_id, first_name, last_name, phone, email, status, subject, notes, lead_source, assigned_agent_id, custom_fields, updated_at")
    .eq("id", contactId)
    .eq("company_id", companyId)
    .eq("assigned_agent_id", agentId)
    .ilike("status", "open")
    .maybeSingle();
  return error || !data ? null : toCrmContact(data as ContactRow);
}

export async function listContactsForAgent({ companyId, agentId, offset = 0, limit = 100 }: { companyId: string; agentId: string; offset?: number; limit?: number }) {
  const { client: supabase, mode } = await createCompanyCrmClient(companyId);
  const activityClient = mode === "shared" ? createSupabaseServiceClient() : supabase;
  const visibleFields = await getAgentContactFields(companyId, agentId);
  const start = Math.max(0, offset);
  const size = Math.min(Math.max(limit, 1), 100);
  const { data, error, count } = await supabase.from("contacts")
    .select("id, company_id, first_name, last_name, phone, email, status, subject, notes, lead_source, assigned_agent_id, custom_fields, updated_at", { count: "exact" })
    .eq("company_id", companyId)
    .eq("assigned_agent_id", agentId)
    .ilike("status", "open")
    .order("updated_at", { ascending: false })
    .range(start, start + size - 1);
  if (error) throw new Error("Assigned contacts could not be loaded.");
  const rows = (data ?? []) as ContactRow[];
  const contactIds = rows.map((row) => row.id);
  const commentResult = contactIds.length ? await activityClient.from("activity_logs")
    .select("target_id, metadata, created_at")
    .eq("company_id", companyId)
    .eq("event_type", "contact_comment_added")
    .eq("target_type", "contact")
    .in("target_id", contactIds)
    .order("created_at", { ascending: false })
    .limit(Math.min(contactIds.length * 20, 1000)) : { data: [], error: null };
  if (commentResult.error) throw new Error("Assigned contact comments could not be loaded.");
  const latestComments = new Map<string, string>();
  for (const row of commentResult.data ?? []) {
    if (!latestComments.has(row.target_id)) {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
      if (typeof metadata.comment === "string") latestComments.set(row.target_id, metadata.comment);
    }
  }
  const agentContacts = rows.map((row) => {
    const contact = toAgentContact(toCrmContact(row), visibleFields);
    contact.lastComment = latestComments.get(row.id) ?? null;
    return contact;
  });
  return {
    contacts: agentContacts,
    total: count ?? 0,
    nextOffset: start + rows.length < (count ?? 0) ? start + rows.length : null,
  };
}