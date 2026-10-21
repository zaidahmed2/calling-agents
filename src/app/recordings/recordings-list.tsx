"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AudioLines } from "lucide-react";

import { EmptyState } from "@/components/ui";
import styles from "@/app/recordings/recordings.module.css";

type RecordingCall = {
  id: string;
  internal_contact_id: string | null;
  answered_at: string;
  verified_duration_seconds: number | null;
  manual_duration_seconds: number | null;
  contactName: string;
  phone: string | null;
  agentName: string;
};

type RecordingStatus = { state: "loading" } | { state: "available"; streamUrl: string } | { state: "missing" } | { state: "error"; message: string };

export default function RecordingsList({ calls, admin }: { calls: RecordingCall[]; admin: boolean }) {
  const [recordings, setRecordings] = useState<Record<string, RecordingStatus>>({});

  useEffect(() => {
    let active = true;
    let nextCall = 0;
    setRecordings(Object.fromEntries(calls.map((call) => [call.id, { state: "loading" as const }])));

    async function checkNext() {
      while (active) {
        const index = nextCall++;
        const call = calls[index];
        if (!call) return;
        try {
          const response = await fetch(`/api/calls/${encodeURIComponent(call.id)}/recording`, { cache: "no-store" });
          const result = await response.json() as { available?: boolean; streamUrl?: string; error?: string };
          if (!response.ok) throw new Error(result.error ?? "Recording could not be checked.");
          const status: RecordingStatus = result.available && result.streamUrl
            ? { state: "available", streamUrl: result.streamUrl }
            : { state: "missing" };
          if (active) setRecordings((current) => ({ ...current, [call.id]: status }));
        } catch (error) {
          if (active) setRecordings((current) => ({
            ...current,
            [call.id]: { state: "error", message: error instanceof Error ? error.message : "Recording could not be checked." },
          }));
        }
      }
    }

    void Promise.all(Array.from({ length: Math.min(4, calls.length) }, () => checkNext()));
    return () => { active = false; };
  }, [calls]);

  const visibleCalls = calls.filter((call) => recordings[call.id]?.state !== "missing");
  const allChecked = calls.every((call) => recordings[call.id] && recordings[call.id].state !== "loading");

  if (!calls.length || (allChecked && visibleCalls.length === 0)) {
    return <EmptyState title="No recordings available" detail="Only answered calls with an available Crazytel recording are shown here." icon={<AudioLines size={18} />} />;
  }

  return <div className={styles.list} aria-live="polite">
    {visibleCalls.map((call) => {
      const status = recordings[call.id] ?? { state: "loading" as const };
      const duration = call.verified_duration_seconds ?? call.manual_duration_seconds;
      return <article className={styles.card} key={call.id}>
        <div className={styles.icon}><AudioLines size={18} /></div>
        <div className={styles.details}>
          <div className={styles.heading}>
            {call.internal_contact_id
              ? <Link href={`/contacts/${encodeURIComponent(call.internal_contact_id)}`}>{call.contactName}</Link>
              : <strong>{call.contactName}</strong>}
            <time>{new Date(call.answered_at).toLocaleString()}</time>
          </div>
          <div className={styles.meta}>
            {call.phone ? <span>{call.phone}</span> : null}
            {admin ? <span>{call.agentName}</span> : null}
            {duration !== null ? <span>{Math.floor(duration / 60)}m {String(duration % 60).padStart(2, "0")}s</span> : null}
          </div>
          {status.state === "loading" ? <span className={styles.pending}>Checking recording availability…</span> : null}
          {status.state === "available" ? <audio controls preload="none" src={status.streamUrl}>Your browser does not support audio playback.</audio> : null}
          {status.state === "error" ? <p className={styles.error} role="alert">{status.message}</p> : null}
        </div>
      </article>;
    })}
  </div>;
}
