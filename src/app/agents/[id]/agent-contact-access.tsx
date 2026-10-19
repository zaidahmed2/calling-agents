"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Save } from "lucide-react";

import styles from "@/app/agents/[id]/agent-detail.module.css";

type FieldOption = { id: string; label: string };

export default function AgentContactAccess({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [fields, setFields] = useState<FieldOption[]>([]);
  const [visibleFields, setVisibleFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/fields`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { fields?: FieldOption[]; visibleFields?: string[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Contact field settings could not be loaded.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setFields(result.fields ?? []);
        setVisibleFields(result.visibleFields ?? []);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Contact field settings could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agentId]);

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibleFields }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Contact field settings could not be saved.");
      setNotice("Agent contact visibility saved.");
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Contact field settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.visibilityPanel}>
    <header><span className={styles.visibilityIcon}><Eye size={16} /></span><div><span className={styles.sectionEyebrow}>CONTACT ACCESS</span><h2>Fields this agent can see</h2><p>Unselected contact fields are hidden in the agent queue and contact profile.</p></div></header>
    {loading ? <p className={styles.visibilityMessage}>Loading CRM fields...</p> : fields.length ? <div className={styles.visibilityFields}>
      {fields.map((field) => <label key={field.id}><input type="checkbox" checked={visibleFields.includes(field.id)} onChange={(event) => setVisibleFields((current) => event.target.checked ? [...current, field.id] : current.filter((id) => id !== field.id))} /><span>{field.label}</span></label>)}
    </div> : !error ? <p className={styles.visibilityMessage}>No CRM fields are available yet.</p> : null}
    {error ? <p className={styles.visibilityError} role="alert">{error}</p> : null}
    {notice ? <p className={styles.visibilityNotice} role="status">{notice}</p> : null}
    <footer><small>{visibleFields.length} fields selected</small><button type="button" onClick={() => void save()} disabled={loading || saving}><Save size={14} />{saving ? "Saving..." : "Save field access"}</button></footer>
  </section>;
}
