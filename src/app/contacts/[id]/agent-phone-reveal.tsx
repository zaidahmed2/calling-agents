"use client";

import { useState } from "react";
import { Eye, EyeOff, Phone } from "lucide-react";

import ProtectedPhone from "@/components/protected-phone";
import styles from "@/app/contacts/[id]/contact-profile.module.css";

export default function AgentPhoneReveal({ contactId, contactName, maskedPhone }: { contactId: string; contactName: string; maskedPhone: string }) {
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (phone) {
      setPhone(null);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/reveal`, { method: "POST", cache: "no-store" });
      const result = await response.json() as { phone?: string; error?: string };
      if (!response.ok || !result.phone) throw new Error(result.error ?? "Could not view this number.");
      setPhone(result.phone);
      window.setTimeout(() => setPhone(null), 30_000);
    } catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : "Could not view this number.");
    } finally {
      setLoading(false);
    }
  }

  return <span className={styles.phoneReveal}>
    <span>{phone ? <><ProtectedPhone phone={phone} callLink={false} /> <a className={styles.revealedCallLink} href={`tel:${phone}`} aria-label={`Call ${contactName}`}><Phone size={13} /></a></> : maskedPhone}</span>
    <button type="button" onClick={() => void toggle()} disabled={loading} aria-label={phone ? `Hide number for ${contactName}` : `View number for ${contactName}`} title={phone ? "Hide number" : "View number"}>
      {phone ? <EyeOff size={14} /> : <Eye size={14} />}{loading ? "Loading" : phone ? "Hide" : "View"}
    </button>
    {error ? <span className={styles.phoneRevealError} role="alert">{error}</span> : null}
  </span>;
}