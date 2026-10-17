import { AppRole, AppSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function getSession(): Promise<AppSession | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user?.email) {
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, normalized_email, ghl_user_id, app_role, platform_role, is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.is_active) {
      await supabase.auth.signOut();
      return null;
    }

    const isSuperAdmin = profile.platform_role === "super_admin";
    const { data: membership, error: membershipError } = await supabase
      .from("company_memberships")
      .select("company_id, role, companies!inner(status)")
      .eq("profile_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError || (!isSuperAdmin && !membership)) {
      await supabase.auth.signOut();
      return null;
    }

    const company = membership?.companies as { status?: string } | null;
    if (!isSuperAdmin && membership && company?.status !== "active") {
      await supabase.auth.signOut();
      return null;
    }

    const role = isSuperAdmin ? "super_admin" : membership?.role;
    if (!role || !["admin", "agent", "super_admin"].includes(role)) {
      await supabase.auth.signOut();
      return null;
    }

    return {
      id: user.id,
      email: profile.normalized_email,
      role: role as AppRole,
      companyId: isSuperAdmin ? null : membership?.company_id ?? null,
      isSuperAdmin,
      ghlUserId: profile.ghl_user_id,
      displayName: user.user_metadata.full_name || user.email.split("@")[0],
    };
  } catch {
    return null;
  }
}
