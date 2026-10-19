"use client";

import { useState } from "react";
import { Building2, ChevronDown, ChevronUp, CirclePlus, Pencil, Power, PowerOff, Save, ShieldCheck, X } from "lucide-react";
import styles from "@/app/super-admin/super-admin.module.css";

type CompanyDatabase = {
  database_mode: "shared" | "external";
  project_ref: string | null;
  connection_status: "pending" | "ready" | "failed" | "disabled";
  tenant_schema_version: string | null;
  migration_status: "pending" | "current" | "failed" | "unknown";
  last_connected_at: string | null;
  provisioning_error_category: string | null;
};

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  initial_admin_email: string | null;
  status: "setup" | "active" | "inactive";
  created_at: string;
  database?: CompanyDatabase | null;
};

export default function SuperAdminConsole({ initialCompanies, initialError = "" }: { initialCompanies: CompanySummary[]; initialError?: string }) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [databaseMode, setDatabaseMode] = useState<"shared" | "external">("shared");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [setupCompanyId, setSetupCompanyId] = useState<string | null>(
    initialCompanies.find((company) => company.database?.database_mode === "external" && company.status === "setup")?.id ?? null,
  );
  const [externalDatabase, setExternalDatabase] = useState<Record<string, { projectRef: string; publishableKey: string; serviceRoleKey: string }>>({});
  const [databaseErrorByCompany, setDatabaseErrorByCompany] = useState<Record<string, string>>({});

  async function createCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/super-admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, adminEmail, databaseMode }),
      });
      const result = await response.json() as { company?: CompanySummary; error?: string };
      if (!response.ok || !result.company) throw new Error(result.error ?? "Company could not be created.");
      setCompanies((current) => [result.company!, ...current]);
      if (databaseMode === "external") {
        setSetupCompanyId(result.company.id);
        setCompanies((current) => current.map((company) => company.id === result.company!.id
          ? { ...company, database: { database_mode: "external", connection_status: "pending", migration_status: "pending", tenant_schema_version: null, last_connected_at: null, provisioning_error_category: null, project_ref: null } }
          : company));
      }
      setName("");
      setAdminEmail("");
      setDatabaseMode("shared");
      setNotice(databaseMode === "external"
        ? `Company created in setup. Apply the tenant migration, then configure and verify its database below. Invitation sent to ${result.company.initial_admin_email}.`
        : `Company created and administrator invitation sent to ${result.company.initial_admin_email}.`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Company could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(company: CompanySummary) {
    const status = company.status === "active" ? "inactive" : "active";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/super-admin/companies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: company.id, status }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Company status could not be updated.");
      setCompanies((current) => current.map((item) => item.id === company.id ? { ...item, status } : item));
      setNotice(`${company.name} is now ${status}.`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Company status could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  async function saveName(company: CompanySummary) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/super-admin/companies", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: company.id, name: editingName }),
      });
      const result = await response.json() as { error?: string; company?: { name: string; status: CompanySummary["status"] } };
      if (!response.ok || !result.company) throw new Error(result.error ?? "Company could not be updated.");
      setCompanies((current) => current.map((item) => item.id === company.id ? { ...item, name: result.company!.name } : item));
      setEditingId(null);
      setNotice("Company details saved.");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Company could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  function updateExternalDatabase(companyId: string, key: "projectRef" | "publishableKey" | "serviceRoleKey", value: string) {
    setExternalDatabase((current) => ({
      ...current,
      [companyId]: { ...(current[companyId] ?? { projectRef: "", publishableKey: "", serviceRoleKey: "" }), [key]: value },
    }));
    setDatabaseErrorByCompany((current) => ({ ...current, [companyId]: "" }));
  }

  async function saveExternalDatabaseConfiguration(company: CompanySummary) {
    const credentials = externalDatabase[company.id];
    if (!credentials?.projectRef.trim() || !credentials.publishableKey.trim() || !credentials.serviceRoleKey.trim()) {
      setDatabaseErrorByCompany((current) => ({ ...current, [company.id]: "Enter the project ID, publishable key, and service-role key." }));
      return;
    }
    setBusy(true);
    setDatabaseErrorByCompany((current) => ({ ...current, [company.id]: "" }));
    setNotice("");
    try {
      const response = await fetch(`/api/super-admin/companies/${encodeURIComponent(company.id)}/database`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });
      const result = await response.json() as { error?: string; database?: CompanyDatabase };
      if (!response.ok || !result.database) throw new Error(result.error ?? "Company database could not be configured.");
      const database = result.database;
      setCompanies((current) => current.map((item) => item.id === company.id
        ? { ...item, database: { ...database, project_ref: database.project_ref ?? credentials.projectRef.trim() } }
        : item));
      setExternalDatabase((current) => ({
        ...current,
        [company.id]: { projectRef: credentials.projectRef, publishableKey: "", serviceRoleKey: "" },
      }));
      setNotice(`${company.name}'s database settings were encrypted and saved. Verify the connection after applying the tenant migration.`);
    } catch (saveError) {
      setDatabaseErrorByCompany((current) => ({
        ...current,
        [company.id]: saveError instanceof Error ? saveError.message : "Company database settings could not be saved.",
      }));
    } finally {
      setBusy(false);
    }
  }

  async function verifyExternalDatabase(company: CompanySummary) {
    setBusy(true);
    setDatabaseErrorByCompany((current) => ({ ...current, [company.id]: "" }));
    setNotice("");
    try {
      const response = await fetch(`/api/super-admin/companies/${encodeURIComponent(company.id)}/database`, { method: "PUT" });
      const result = await response.json() as { error?: string; database?: CompanyDatabase };
      if (!response.ok || !result.database) throw new Error(result.error ?? "Database verification failed.");
      const database = result.database;
      setCompanies((current) => current.map((item) => item.id === company.id
        ? { ...item, status: "active", database }
        : item));
      setNotice(`${company.name}'s database is verified and the company is active.`);
      setSetupCompanyId(null);
    } catch (verifyError) {
      setDatabaseErrorByCompany((current) => ({
        ...current,
        [company.id]: verifyError instanceof Error ? verifyError.message : "Database verification failed.",
      }));
      setCompanies((current) => current.map((item) => item.id === company.id
        ? item.database ? { ...item, database: { ...item.database, connection_status: "failed", migration_status: "failed" } } : item
        : item));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <form className={styles.companyCreate} onSubmit={(event) => void createCompany(event)}>
      <header><Building2 size={18} /><div><h2>New company</h2><p>The company administrator receives an email invitation.</p></div></header>
      <div className={styles.companyFields}>
        <label>Company name<input required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Company name" /></label>
        <label>Administrator email<input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="admin@company.com" /></label>
        <label>CRM database<select value={databaseMode} onChange={(event) => setDatabaseMode(event.target.value as "shared" | "external")}><option value="shared">Existing shared database</option><option value="external">Company Supabase project</option></select></label>
        <button type="submit" disabled={busy}><CirclePlus size={16} />{busy ? "Working..." : "Create company"}</button>
      </div>
    </form>
    {error ? <p className={`${styles.platformMessage} ${styles.error}`} role="alert">{error}</p> : null}
    {notice ? <p className={`${styles.platformMessage} ${styles.success}`} role="status">{notice}</p> : null}
    <section className={styles.companyList} aria-label="Companies">
      <div className={styles.companyListHeader}><h2>All companies</h2><span>{companies.length} total</span></div>
      {companies.length ? companies.map((company) => <article className={styles.companyRow} key={company.id}>
        <span className={styles.companyIcon}><Building2 size={18} /></span>
        <div className={styles.companyIdentity}>{editingId === company.id ? <input aria-label="Company name" value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={160} /> : <strong>{company.name}</strong>}<span>{company.slug}</span></div>
        <div className={styles.companyAdmin}><small>INITIAL ADMIN</small><span>{company.initial_admin_email ?? "Not designated"}</span></div>
        <span className={`${styles.companyStatus} ${styles[company.status]}`}>{company.status.replace("_", " ")}</span>
        {editingId === company.id ? <><button className={styles.companyToggle} type="button" onClick={() => void saveName(company)} disabled={busy || editingName.trim().length < 2} aria-label={`Save ${company.name}`} title="Save company name"><Save size={15} /></button><button className={styles.companyToggle} type="button" onClick={() => setEditingId(null)} disabled={busy} aria-label="Cancel name edit" title="Cancel"><X size={15} /></button></> : <><button className={styles.companyToggle} type="button" onClick={() => { setEditingId(company.id); setEditingName(company.name); }} aria-label={`Edit ${company.name}`} title="Edit company"><Pencil size={15} /></button><button className={styles.companyToggle} type="button" onClick={() => void setStatus(company)} disabled={busy || company.status === "setup"} aria-label={`${company.status === "active" ? "Deactivate" : "Activate"} ${company.name}`} title={`${company.status === "active" ? "Deactivate" : "Activate"} company`}>
          {company.status === "active" ? <PowerOff size={16} /> : <Power size={16} />}
        </button></>}
        <div className={styles.companyDatabase}>
          <div className={styles.databaseSummary}>
            <strong>CRM database: {company.database?.database_mode ?? "not configured"} · {company.database?.connection_status ?? "unknown"}</strong>
            {company.database?.database_mode === "external" && company.status === "setup" ? <button type="button" className={styles.databaseExpand} aria-expanded={setupCompanyId === company.id} aria-controls={`database-setup-${company.id}`} onClick={() => setSetupCompanyId(setupCompanyId === company.id ? null : company.id)}>
              {setupCompanyId === company.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {setupCompanyId === company.id ? "Hide setup" : "Configure database"}
            </button> : null}
            {company.database?.database_mode === "external" && company.database.project_ref ? <span className={styles.projectRef}>Project: {company.database.project_ref}</span> : null}
          </div>
          {company.database?.database_mode === "external" && company.status === "setup" && setupCompanyId === company.id ? <div id={`database-setup-${company.id}`} className={styles.databaseSetup}>
            <p>Apply <code>supabase/tenant-migrations/20261018_000001_tenant_crm.sql</code> in this company’s Supabase project first. The publishable key identifies the project; the service-role key is required for server-side CRM access and is encrypted before storage.</p>
            <div className={styles.databaseFields}>
              <label>Supabase project ID<input type="text" autoComplete="off" value={externalDatabase[company.id]?.projectRef ?? ""} onChange={(event) => updateExternalDatabase(company.id, "projectRef", event.target.value)} placeholder="e.g. abcdefghijklmnopqrst" /></label>
              <label>Project publishable key<input type="password" autoComplete="new-password" value={externalDatabase[company.id]?.publishableKey ?? ""} onChange={(event) => updateExternalDatabase(company.id, "publishableKey", event.target.value)} /></label>
              <label>Project service-role key<input type="password" autoComplete="new-password" value={externalDatabase[company.id]?.serviceRoleKey ?? ""} onChange={(event) => updateExternalDatabase(company.id, "serviceRoleKey", event.target.value)} /></label>
              <button type="button" onClick={() => void saveExternalDatabaseConfiguration(company)} disabled={busy}><Save size={14} />{busy ? "Saving..." : "Save / Configure"}</button>
              <button type="button" className={styles.verifyDatabase} onClick={() => void verifyExternalDatabase(company)} disabled={busy || !company.database.project_ref}><ShieldCheck size={14} />{busy ? "Checking..." : "Verify Database"}</button>
            </div>
            {databaseErrorByCompany[company.id] ? <p className={styles.databaseError} role="alert">{databaseErrorByCompany[company.id]}</p> : null}
            {company.database.project_ref ? <p className={styles.databaseSaved}>Configuration saved. Last connection check: {company.database.last_connected_at ? new Date(company.database.last_connected_at).toLocaleString() : "not yet verified"}.</p> : null}
          </div> : null}
        </div>
      </article>) : <p className={styles.companyEmpty}>No companies have been created.</p>}
    </section>
  </>;
}