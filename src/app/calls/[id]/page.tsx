import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, AudioLines, CalendarClock, Phone, UserRound } from "lucide-react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { EmptyState, StatusBadge } from "@/components/ui";
import { getCompanyContact } from "@/lib/contacts";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/calls/calls.module.css";
import { createCompanyCrmClient } from "@/lib/company-database";

export const dynamic = "force-dynamic";

type CallRow = { id: string; agent_id: string; ghl_contact_id: string; internal_contact_id: string | null; current_state: string; requested_at: string; answered_at: string | null; ended_at: string | null; verified_duration_seconds: number | null; outcome: string | null };
type DispositionRow = { outcome: string; note: string | null; qualified: boolean; callback_at: string | null; callback_timezone: string | null; created_at: string };

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");
  const { id } = await params;

  if (!session.companyId) redirect("/login?access=denied");
  const supabase = await createSupabaseServerClient();
  const { client: crm } = await createCompanyCrmClient(session.companyId);
  const { data: callData, error } = await crm.from("calls").select("id, agent_id, ghl_contact_id, internal_contact_id, current_state, requested_at, answered_at, ended_at, verified_duration_seconds, outcome").eq("id", id).eq("company_id", session.companyId).maybeSingle();
  if (error) return <WorkspaceShell session={session} section="calls" title="Call details"><div className={styles.error} role="alert">Call details are unavailable. Check database connectivity and permissions.</div></WorkspaceShell>;
  if (!callData) notFound();
  const call = callData as CallRow;
  const [contact, agentResult, dispositionResult] = await Promise.all([
    call.internal_contact_id && session.companyId ? getCompanyContact(call.internal_contact_id, session.companyId) : Promise.resolve(null),
    supabase.from("profiles").select("normalized_email").eq("id", call.agent_id).maybeSingle(),
    crm.from("call_dispositions").select("outcome, note, qualified, callback_at, callback_timezone, created_at").eq("company_id", session.companyId).eq("call_id", call.id).order("created_at", { ascending: false }),
  ]);
  const dispositions = (dispositionResult.data ?? []) as DispositionRow[];
  const tone = call.current_state === "answered" || call.current_state === "completed" ? "success" : call.current_state === "failed" || call.current_state === "cancelled" ? "danger" : "neutral";

  return <WorkspaceShell session={session} section="calls" title="Call details" subtitle="Saved call events and available notes.">
    <Link href="/calls" className={styles.backLink}><ArrowLeft size={15} /> Call history</Link>
    <section className={styles.callDetail}>
      <header><div><span className={styles.detailEyebrow}>CALL RECORD</span><h2>{contact?.name ?? `Legacy contact ${call.ghl_contact_id}`}</h2><span className={styles.detailId}>{call.id}</span></div><StatusBadge tone={tone}>{call.current_state}</StatusBadge></header>
      <div className={styles.detailGrid}>
        <div><span><Phone size={14} /> Phone</span><strong>{contact?.phone ?? "Unavailable"}</strong></div>
        <div><span><UserRound size={14} /> Agent</span><strong>{agentResult.data?.normalized_email ?? "Unknown agent"}</strong></div>
        <div><span><CalendarClock size={14} /> Requested</span><strong>{new Date(call.requested_at).toLocaleString()}</strong></div>
        <div><span><AudioLines size={14} /> Duration</span><strong>{call.verified_duration_seconds === null ? "Unavailable" : `${Math.floor(call.verified_duration_seconds / 60)}m ${String(call.verified_duration_seconds % 60).padStart(2, "0")}s`}</strong></div>
        <div><span>Answered</span><strong>{call.answered_at ? new Date(call.answered_at).toLocaleString() : "Not recorded"}</strong></div>
        <div><span>Ended</span><strong>{call.ended_at ? new Date(call.ended_at).toLocaleString() : "Not recorded"}</strong></div>
        <div><span>Disposition</span><strong>{dispositions[0]?.outcome ?? call.outcome ?? "Not recorded"}</strong></div>
      </div>
    </section>
    <section className={styles.callDetail}>
      <header><div><span className={styles.detailEyebrow}>SAVED NOTES</span><h2>Call activity</h2></div><StatusBadge tone="neutral">{dispositions.length}</StatusBadge></header>
      {dispositionResult.error ? <div className={styles.error} role="alert">Saved notes could not be loaded.</div> : dispositions.length ? <div className={styles.dispositionList}>{dispositions.map((item, index) => <article key={`${item.created_at}-${index}`}><div><strong>{item.outcome}</strong><time>{new Date(item.created_at).toLocaleString()}</time></div>{item.note ? <p>{item.note}</p> : <p>No note was saved.</p>}{item.qualified ? <StatusBadge tone="success">Qualified</StatusBadge> : null}{item.callback_at ? <small>Callback {new Date(item.callback_at).toLocaleString()}{item.callback_timezone ? ` · ${item.callback_timezone}` : ""}</small> : null}</article>)}</div> : <EmptyState title="No saved call notes" detail="Only recorded dispositions are shown here." icon={<AudioLines size={17} />} />}
    </section>
  </WorkspaceShell>;
}