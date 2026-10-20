"use server";

import { redirect } from "next/navigation";

import { ADMIN_COMPANY_CONTEXT_COOKIE } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { cookies } from "next/headers";

async function clearAdminCompanyContext() {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COMPANY_CONTEXT_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function logout() {
  await clearAdminCompanyContext();
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function returnToSuperAdmin() {
  const session = await getSession();
  if (!session?.isSuperAdmin || !session.isImpersonating) redirect("/super-admin");
  await clearAdminCompanyContext();
  redirect("/super-admin");
}
