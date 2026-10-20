import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

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
    const { error } = await createSupabaseServiceClient().from("activity_logs").insert({
      company_id: companyId,
      actor_id: agentId,
      event_type: "agent_phone_revealed",
      target_type: "contact",
      target_id: contactId,
    });
    if (!error) return true;
    console.error("Could not audit agent phone access.", error);
  } catch (error) {
    console.error("Could not audit agent phone access.", error);
  }
  return false;
}