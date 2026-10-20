import { cookies } from "next/headers";

import { ADMIN_COMPANY_CONTEXT_COOKIE, AppRole, AppSession, isCompanyId } from "@/lib/auth";
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
    let actingCompanyId: string | null = null;
    if (isSuperAdmin) {
      const selectedCompanyId = (await cookies()).get(ADMIN_COMPANY_CONTEXT_COOKIE)?.value;
      if (isCompanyId(selectedCompanyId)) actingCompanyId = selectedCompanyId;
    }

    const { data: membership, error: membershipError } = isSuperAdmin
      ? { data: null, error: null }
      : await supabase
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

    const role = actingCompanyId ? "admin" : isSuperAdmin ? "super_admin" : membership?.role;
    if (!role || !["admin", "agent", "super_admin"].includes(role)) {
      await supabase.auth.signOut();
      return null;
    }

    return {
      id: user.id,
      email: profile.normalized_email,
      role: role as AppRole,
      companyId: actingCompanyId ?? (isSuperAdmin ? null : membership?.company_id ?? null),
      isSuperAdmin,
      isImpersonating: Boolean(actingCompanyId),
      ghlUserId: profile.ghl_user_id,
      displayName: user.user_metadata.full_name || user.email.split("@")[0],
    };
  } catch {
    return null;
  }
}
