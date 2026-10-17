"use client";

import { useState } from "react";
import { Building2, CirclePlus, Pencil, Power, PowerOff, Save, X } from "lucide-react";
import styles from "@/app/super-admin/super-admin.module.css";

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  initial_admin_email: string | null;
  status: "setup" | "active" | "inactive";
  created_at: string;
};

export default function SuperAdminConsole({ initialCompanies, initialError = "" }: { initialCompanies: CompanySummary[]; initialError?: string }) {
  const [companies, setCompanies] = useState(initialCompanies);
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  async function createCompany(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/super-admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, adminEmail }),
      });
      const result = await response.json() as { company?: CompanySummary; error?: string };
      if (!response.ok || !result.company) throw new Error(result.error ?? "Company could not be created.");
      setCompanies((current) => [result.company!, ...current]);
      setName("");
      setAdminEmail("");
      setNotice(`Company created and administrator invitation sent to ${result.company.initial_admin_email}.`);
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

  return <>
    <form className={styles.companyCreate} onSubmit={(event) => void createCompany(event)}>
      <header><Building2 size={18} /><div><h2>New company</h2><p>The company administrator receives an email invitation.</p></div></header>
      <div className={styles.companyFields}><label>Company name<input required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Company name" /></label><label>Administrator email<input required type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="admin@company.com" /></label><button type="submit" disabled={busy}><CirclePlus size={16} />{busy ? "Working..." : "Create company"}</button></div>
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
      </article>) : <p className={styles.companyEmpty}>No companies have been created.</p>}
    </section>
  </>;
}