"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Database, LoaderCircle } from "lucide-react";

import styles from "@/components/company-migration-guard.module.css";

type MigrationStatus = {
  required?: boolean;
  version?: string;
  canApply?: boolean;
  admin?: boolean;
  missingToken?: boolean;
  error?: string;
};

export default function CompanyMigrationGuard({ enabled, admin }: { enabled: boolean; admin: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [checking, setChecking] = useState(enabled);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void fetch("/api/company/migrations", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as MigrationStatus;
        if (!response.ok) throw new Error(result.error ?? "Database migration status could not be checked.");
        if (active) setStatus(result);
      })
      .catch((checkError: unknown) => {
        if (active) setError(checkError instanceof Error ? checkError.message : "Database migration status could not be checked.");
      })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [enabled]);

  async function applyUpdate() {
    setUpdating(true);
    setError("");
    try {
      const response = await fetch("/api/company/migrations", { method: "POST", cache: "no-store" });
      const result = await response.json() as MigrationStatus;
      if (!response.ok) throw new Error(result.error ?? "Company database could not be updated.");
      setStatus(result);
      router.refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Company database could not be updated.");
    } finally {
      setUpdating(false);
    }
  }

  if (!enabled || checking || (!status?.required && !error)) return null;

  return <div className={styles.backdrop}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="tenant-update-title">
      <span className={styles.icon}><Database size={21} /></span>
      <span className={styles.eyebrow}>COMPANY DATABASE UPDATE</span>
      <h2 id="tenant-update-title">{error ? "Database update needs attention" : "Update required"}</h2>
      <p>{error
        ? "This company database could not be verified or updated. Your current data has not been changed by this check."
        : `A required CRM database migration${status?.version ? ` (${status.version})` : ""} is available. Update it to continue using this company workspace.`}</p>
      {status?.missingToken ? <p className={styles.setup}>The app server needs the server-only SUPABASE_MANAGEMENT_API_TOKEN setting before it can apply database changes.</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {admin && status?.canApply ? <button type="button" onClick={() => void applyUpdate()} disabled={updating}>
        {updating ? <><LoaderCircle size={15} className={styles.spinner} /> Updating company database…</> : "Update application"}
      </button> : !admin ? <p className={styles.setup}>Ask a company administrator to apply this update. The workspace will be available after the update completes.</p> : null}
    </section>
  </div>;
}
