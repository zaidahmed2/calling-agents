import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { ADMIN_COMPANY_CONTEXT_COOKIE, isCompanyId } from "@/lib/auth";
import { env } from "@/lib/env";

export async function createSupabaseServerClient() {
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase Auth is not configured. Set the public Supabase URL and publishable/anon key.");
  }

  const cookieStore = await cookies();
  const companyId = cookieStore.get(ADMIN_COMPANY_CONTEXT_COOKIE)?.value;

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: {
      headers: isCompanyId(companyId) ? { "x-company-context": companyId } : {},
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server components cannot write cookies; the proxy refreshes tokens on requests.
        }
      },
    },
  });
}