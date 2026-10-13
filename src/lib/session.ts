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
      .select("id, normalized_email, ghl_user_id, app_role, is_active")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.is_active || !["admin", "agent"].includes(profile.app_role)) {
      await supabase.auth.signOut();
      return null;
    }

    return {
      id: user.id,
      email: profile.normalized_email,
      role: profile.app_role as AppRole,
      ghlUserId: profile.ghl_user_id,
      displayName: user.user_metadata.full_name || user.email.split("@")[0],
    };
  } catch {
    return null;
  }
}
