import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { logout } from "@/app/dashboard/actions";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import SuperAdminConsole, { type CompanySummary } from "@/app/super-admin/super-admin-console";
import styles from "@/app/super-admin/super-admin.module.css";

export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.isSuperAdmin) redirect(session.role === "admin" ? "/dashboard" : "/open-queue");

  let companies: CompanySummary[] = [];
  let initialError = "";
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("companies")
      .select("id, name, slug, initial_admin_email, status, created_at")
      .order("created_at", { ascending: false });
    const { data: databases, error: databaseError } = await supabase.from("company_databases")
      .select("company_id, database_mode, project_ref, connection_status, tenant_schema_version, migration_status, last_connected_at, provisioning_error_category");
    if (error || databaseError) initialError = "Company records could not be loaded.";
    else {
      const databaseByCompany = new Map((databases ?? []).map((item) => [item.company_id, item]));
      companies = (data ?? []).map((company) => ({
        ...company,
        database: databaseByCompany.get(company.id) ?? null,
      })) as CompanySummary[];
    }
  } catch {
    initialError = "Company records could not be loaded.";
  }

  return <main className={styles.platformLayout}>
    <header className={styles.platformHeader}><a className={styles.platformBrand} href="/super-admin"><span>TV</span><b>PLATFORM</b></a><div><small>SUPER ADMIN</small><strong>{session.displayName}</strong></div><form action={logout}><button className={styles.platformLogout} type="submit" aria-label="Log out" title="Log out"><LogOut size={16} /></button></form></header>
    <section className={styles.platformContent}><div className={styles.platformIntro}><div><span>PLATFORM OPERATIONS</span><h1>Companies</h1><p>Create and manage tenant workspaces.</p></div><span className={styles.companyCount}>{companies.length} workspaces</span></div>
      <SuperAdminConsole initialCompanies={companies} initialError={initialError} />
    </section>
  </main>;
}