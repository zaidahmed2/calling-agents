"use client";

import { useState } from "react";
import { Pencil, Save, X } from "lucide-react";

import styles from "@/app/contacts/[id]/contact-profile.module.css";

export default function ContactEditor({ contact, agents }: {
  contact: { id: string; name: string; phone: string | null; email?: string; status: string | null; subject?: string; notes?: string | null; assignedAgentId: string | null };
  agents: Array<{ id: string; email: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ name: contact.name, phone: contact.phone ?? "", email: contact.email ?? "", status: contact.status ?? "open", subject: contact.subject ?? "", notes: contact.notes ?? "", assignedAgentId: contact.assignedAgentId ?? "" });

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/contacts/${encodeURIComponent(contact.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Contact update failed.");
      setNotice("Contact details saved.");
      setEditing(false);
      window.location.reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Contact update failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) return <div className={styles.editorActions}>
    <button type="button" className={styles.secondaryButton} onClick={() => setEditing(true)}><Pencil size={14} /> Edit contact</button>
    {notice ? <span role="status">{notice}</span> : null}
    {error ? <span role="alert">{error}</span> : null}
  </div>;

  return <form className={styles.contactEditor} onSubmit={(event) => void save(event)}>
    <div className={styles.editorGrid}>
      <label>Name<input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
      <label>Phone<input type="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></label>
      <label>Email<input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
      <label>Status<input required maxLength={80} value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} /></label>
      <label>Subject<input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} /></label>
      <label>Assigned agent<select value={form.assignedAgentId} onChange={(event) => setForm((current) => ({ ...current, assignedAgentId: event.target.value }))}><option value="">Unassigned</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.email}</option>)}</select></label>
      <label className={styles.editorNotes}>Notes<textarea rows={4} maxLength={5000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
    </div>
    {error ? <p className={styles.editorError} role="alert">{error}</p> : null}
    <div className={styles.editorActions}><button className={styles.primaryButton} type="submit" disabled={saving}><Save size={14} />{saving ? "Saving..." : "Save contact"}</button><button className={styles.secondaryButton} type="button" onClick={() => setEditing(false)} disabled={saving}><X size={14} />Cancel</button></div>
  </form>;
}