"use client";

import { FormEvent, useState } from "react";

import styles from "@/app/dispositions/page.module.css";

export default function DispositionPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const payload = {
      contactId: String(formData.get("contactId") ?? ""),
      outcome: String(formData.get("outcome") ?? "follow-up"),
      notes: String(formData.get("notes") ?? ""),
      qualified: formData.get("qualified") === "on",
      callbackAt: String(formData.get("callbackAt") ?? ""),
    };

    try {
      const response = await fetch("/api/dispositions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = (await response.json()) as { message?: string; reason?: string; blocked?: boolean };
      setMessage(result.message ?? result.reason ?? "Disposition request processed.");
    } catch {
      setMessage("The disposition request could not be submitted.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Call outcome</p>
            <h1>Disposition and CRM sync</h1>
          </div>
        </div>

        <form className={styles.form} onSubmit={onSubmit}>
          <label>
            Contact ID
            <input name="contactId" required placeholder="GHL contact ID" />
          </label>

          <label>
            Outcome
            <select name="outcome" defaultValue="follow-up">
              <option value="qualified">Qualified</option>
              <option value="follow-up">Follow-up</option>
              <option value="not-interested">Not interested</option>
              <option value="no-answer">No answer</option>
              <option value="busy">Busy</option>
              <option value="failed">Failed</option>
            </select>
          </label>

          <label>
            Notes
            <textarea name="notes" rows={4} />
          </label>

          <label className={styles.inlineCheckbox}>
            <input name="qualified" type="checkbox" />
            Mark as qualified lead
          </label>

          <label>
            Callback time
            <input name="callbackAt" type="datetime-local" />
          </label>

          <button type="submit" disabled={loading}>
            {loading ? "Submitting..." : "Submit disposition"}
          </button>
        </form>

        {message ? (
          <div className={styles.notice} role="alert">
            <strong>Sync status</strong>
            <p>{message}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
