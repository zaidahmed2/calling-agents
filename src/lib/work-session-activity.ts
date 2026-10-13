import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function recordAgentWorkActivity(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.rpc("work_session_action", { p_action: "activity" });
  } catch {
    // Timer activity must not block the authorized contact or callback action.
  }
}

export async function auditAgentPhoneReveal(contactId: string): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("audit_agent_phone_reveal", { p_contact_id: contactId });
    return !error && data === true;
  } catch {
    return false;
  }
}