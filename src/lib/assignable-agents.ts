import { createSupabaseServerClient } from "@/lib/supabase-server";

export type ActiveAgentProfile = { id: string; email: string; ghlUserId: string | null; name: string };
export type AssignableAgent = ActiveAgentProfile & { ghlUserId: string };

export async function listActiveAgentProfiles(): Promise<ActiveAgentProfile[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, normalized_email, ghl_user_id")
    .eq("app_role", "agent")
    .eq("is_active", true)
    .order("normalized_email");
  if (error) throw new Error("Agent mappings could not be loaded.");

  return (data ?? []).map((profile) => ({
      id: profile.id,
      email: profile.normalized_email,
      ghlUserId: profile.ghl_user_id,
      name: profile.normalized_email,
    }));
}

export async function listAssignableAgents(): Promise<AssignableAgent[]> {
  const profiles = await listActiveAgentProfiles();
  return profiles.flatMap((profile) => profile.ghlUserId
    ? [{ ...profile, ghlUserId: profile.ghlUserId }]
    : []);
}