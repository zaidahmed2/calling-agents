import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getSession } from "@/lib/session";

export type ActiveAgentProfile = { id: string; email: string; ghlUserId: string | null; name: string };
export type AssignableAgent = ActiveAgentProfile & { ghlUserId: string };
export type CompanyAgentProfile = ActiveAgentProfile & { isActive: boolean };

export async function listCompanyAgentProfiles(companyId: string): Promise<CompanyAgentProfile[]> {
  const supabase = await createSupabaseServerClient();
  const { data: memberships, error: membershipError } = await supabase
    .from("company_memberships")
    .select("profile_id, is_active")
    .eq("company_id", companyId)
    .eq("role", "agent")
    .order("created_at", { ascending: false });
  if (membershipError) throw new Error("Company agents could not be loaded.");
  const ids = (memberships ?? []).map((membership) => membership.profile_id);
  if (!ids.length) return [];
  const { data: profiles, error: profileError } = await supabase.from("profiles")
    .select("id, normalized_email, ghl_user_id, is_active")
    .in("id", ids)
    .order("normalized_email");
  if (profileError) throw new Error("Company agents could not be loaded.");
  const activeMemberships = new Map((memberships ?? []).map((membership) => [membership.profile_id, membership.is_active]));
  return (profiles ?? []).map((profile) => ({
    id: profile.id,
    email: profile.normalized_email,
    ghlUserId: profile.ghl_user_id,
    name: profile.normalized_email,
    isActive: Boolean(profile.is_active && activeMemberships.get(profile.id)),
  }));
}

export async function listActiveAgentProfiles(): Promise<ActiveAgentProfile[]> {
  const session = await getSession();
  if (!session?.companyId) throw new Error("Company access is required to load agents.");
  return (await listCompanyAgentProfiles(session.companyId))
    .filter((agent) => agent.isActive)
    .map(({ id, email, ghlUserId, name }) => ({ id, email, ghlUserId, name }));
}

export async function listAssignableAgents(): Promise<AssignableAgent[]> {
  const profiles = await listActiveAgentProfiles();
  return profiles.map((profile) => ({ ...profile, ghlUserId: profile.ghlUserId ?? profile.id }));
}