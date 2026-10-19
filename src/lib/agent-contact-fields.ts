import { createSupabaseServerClient } from "@/lib/supabase-server";

export const STANDARD_AGENT_CONTACT_FIELDS = [
  { id: "name", label: "Name" },
  { id: "email", label: "Email" },
  { id: "phone", label: "Phone number" },
  { id: "status", label: "Status" },
  { id: "subject", label: "Subject" },
  { id: "notes", label: "Notes" },
  { id: "lead_source", label: "Lead source" },
] as const;

export const DEFAULT_AGENT_CONTACT_FIELDS = STANDARD_AGENT_CONTACT_FIELDS.map(({ id }) => id);

export async function getAgentContactFields(companyId: string, agentId: string): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("company_memberships")
    .select("agent_contact_fields")
    .eq("company_id", companyId)
    .eq("profile_id", agentId)
    .eq("role", "agent")
    .maybeSingle();
  if (error) {
    if (error.message.includes("agent_contact_fields")) {
      throw new Error("Apply migration 20261019_000017_agent_contact_field_access.sql to the central Supabase database.");
    }
    throw new Error("Agent contact visibility settings could not be loaded.");
  }
  if (!data) throw new Error("Agent contact visibility settings could not be loaded.");
  return Array.isArray(data.agent_contact_fields) ? data.agent_contact_fields.filter((field): field is string => typeof field === "string") : [];
}
