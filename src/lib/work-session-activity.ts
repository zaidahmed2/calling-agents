import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createCompanyCrmClient } from "@/lib/company-database";

export async function recordAgentWorkActivity(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.rpc("work_session_action", { p_action: "activity" });
  } catch {
    // Timer activity must not block the authorized contact or callback action.
  }
}

export async function auditAgentPhoneReveal(contactId: string, companyId: string, agentId: string): Promise<boolean> {
  try {
    const { client: supabase, mode } = await createCompanyCrmClient(companyId);
    const args = mode === "shared"
      ? { p_contact_id: contactId }
      : { p_company_id: companyId, p_actor_id: agentId, p_contact_id: contactId };
    const { data, error } = await supabase.rpc("audit_agent_phone_reveal", args);
    return !error && data === true;
  } catch {
    return false;
  }
}