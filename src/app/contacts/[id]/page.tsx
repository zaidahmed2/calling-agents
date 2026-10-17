import { notFound, redirect } from "next/navigation";
import { AudioLines, CalendarClock, Phone, UserRound } from "lucide-react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { EmptyState, StatusBadge } from "@/components/ui";
import { getCompanyContact, getOpenContactForAgent } from "@/lib/contacts";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/contacts/[id]/contact-profile.module.css";
import AgentPhoneReveal from "@/app/contacts/[id]/agent-phone-reveal";
import { recordAgentWorkActivity } from "@/lib/work-session-activity";
import AgentCallWorkflow from "@/app/contacts/[id]/agent-call-workflow";
import ContactEditor from "@/app/contacts/[id]/contact-editor";
import { listActiveAgentProfiles } from "@/lib/assignable-agents";

export const dynamic = "force-dynamic";

type CallRow = { id: string; agent_id: string; current_state: string; requested_at: string; answered_at: string | null; ended_at: string | null; verified_duration_seconds: number | null; outcome: string | null };
type DispositionRow = { call_id: string; outcome: string; note: string | null; qualified: boolean; callback_at: string | null; created_at: string };
type CallbackRow = { id: string; due_at: string; timezone: string; status: string; completed_at: string | null };

export default async function ContactDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ message?: string; callsPage?: string; size?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.companyId || session.isSuperAdmin) redirect(session.isSuperAdmin ? "/super-admin" : "/login?access=denied");
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const callsPage = Math.max(1, Number(query.callsPage) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(query.size)) ? Number(query.size) : 25;

  const contact = await getCompanyContact(id, session.companyId);
  if (!contact) notFound();
  if (session.role === "agent") {
    const authorizedContact = await getOpenContactForAgent(id, session.companyId, session.id);
    if (!authorizedContact) notFound();
    await recordAgentWorkActivity();
  }

  let calls: CallRow[] = [];
  let dispositions: DispositionRow[] = [];
  let callbacks: CallbackRow[] = [];
  let callCount = 0;
  let agentName = contact.assignedUserId ? "Assigned agent" : "Unassigned";
  let activeAgents: Array<{ id: string; email: string }> = [];
  let historyAvailable = false;
  try {
    const supabase = await createSupabaseServerClient();
    const [callResult, callbackResult, agentResult] = await Promise.all([
      supabase.from("calls").select("id, agent_id, current_state, requested_at, answered_at, ended_at, verified_duration_seconds, outcome", { count: "exact" }).eq("internal_contact_id", id).order("requested_at", { ascending: false }).range((callsPage - 1) * pageSize, callsPage * pageSize - 1),
      supabase.from("callbacks").select("id, due_at, timezone, status, completed_at").eq("internal_contact_id", id).order("due_at", { ascending: false }).limit(50),
      contact.assignedUserId ? supabase.from("profiles").select("normalized_email").eq("id", contact.assignedUserId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (!callResult.error && !callbackResult.error) {
      calls = callResult.data ?? [];
      callCount = callResult.count ?? 0;
      callbacks = callbackResult.data ?? [];
      historyAvailable = true;
      const ids = calls.map((call) => call.id);
      if (ids.length) {
        const dispositionResult = await supabase.from("call_dispositions").select("call_id, outcome, note, qualified, callback_at, created_at").in("call_id", ids).order("created_at", { ascending: false });
        if (!dispositionResult.error) dispositions = (dispositionResult.data ?? []) as DispositionRow[];
      }
    }
    if (session.role === "admin" && agentResult.data?.normalized_email) agentName = agentResult.data.normalized_email;
    if (session.role === "admin") activeAgents = (await listActiveAgentProfiles()).map((agent) => ({ id: agent.id, email: agent.email }));
  } catch {
    historyAvailable = false;
  }

  const latestDisposition = new Map<string, DispositionRow>();
  for (const item of dispositions) if (!latestDisposition.has(item.call_id)) latestDisposition.set(item.call_id, item);
  const timeline = [
    ...calls.map((call) => ({ id: `call-${call.id}`, time: call.requested_at, title: `Call ${call.current_state}`, detail: latestDisposition.get(call.id)?.outcome ?? call.outcome ?? "Outcome not recorded" })),
    ...callbacks.map((callback) => ({ id: `callback-${callback.id}`, time: callback.due_at, title: `Callback ${callback.status}`, detail: `Due in ${callback.timezone}` })),
  ].sort((left, right) => new Date(right.time).getTime() - new Date(left.time).getTime()).slice(0, 40);
  const pageCount = Math.max(1, Math.ceil(callCount / pageSize));
  const callPageHref = (page: number) => `/contacts/${encodeURIComponent(id)}?callsPage=${page}&size=${pageSize}#call-history`;

  return <WorkspaceShell session={session} section="contacts" title={contact.name} subtitle={session.role === "admin" ? "Contact profile and saved history." : "Assigned contact details and saved activity."}>
    {query.message ? <div className={styles.notice} role="status">{query.message}</div> : null}
    <div className={styles.profileGrid}>
      <section className={styles.profilePanel}>
        <div className={styles.profileTop}><span className={styles.profileAvatar}>{contact.name.slice(0, 1).toUpperCase()}</span><div><span className={styles.eyebrow}>CONTACT</span><h2>{contact.name}</h2><StatusBadge tone={contact.isOpen ? "success" : contact.status ? "neutral" : "warning"}>{contact.status ?? "Unknown status"}</StatusBadge></div></div>
        {session.role === "agent" ? <div className={styles.agentContactInfo}><div><small>SUBURB</small><span>{contact.suburb ?? "—"}</span></div><div><small>PHONE</small><AgentPhoneReveal contactId={contact.id} contactName={contact.name} maskedPhone={contact.maskedPhone} /></div></div> : <div className={styles.infoGrid}><div><small>PHONE</small><a href={contact.phone ? `tel:${contact.phone}` : undefined}><Phone size={13} /> {contact.phone ?? "Not available"}</a></div><div><small>EMAIL</small><span>{contact.email ?? "Not available"}</span></div><div><small>ASSIGNED AGENT</small><span><UserRound size={13} /> {agentName}</span></div><div><small>CONTACT ID</small><span className={styles.mono}>{contact.id}</span></div><div><small>SUBJECT</small><span>{contact.subject ?? "Not set"}</span></div></div>}
        {session.role === "agent" ? <AgentCallWorkflow contactId={contact.id} contactName={contact.name} /> : null}
        {session.role === "admin" ? <ContactEditor contact={{ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, status: contact.status, subject: contact.subject, notes: contact.notes, assignedAgentId: contact.assignedAgentId }} agents={activeAgents} /> : null}
      </section>
      <section className={styles.profilePanel} id="call-history">
        <header className={styles.panelHeader}><div><span className={styles.eyebrow}>CALL HISTORY</span><h2>Saved calls</h2></div><StatusBadge tone="neutral">{callCount} records</StatusBadge></header>
        {!historyAvailable ? <EmptyState title="History unavailable" detail="Check database connectivity and permissions." icon={<AudioLines size={17} />} /> : calls.length ? <><div className={styles.historyList}>{calls.map((call) => { const disposition = latestDisposition.get(call.id); return <article className={styles.historyItem} key={call.id}><div className={styles.historyGlyph}><AudioLines size={15} /></div><div className={styles.historyBody}><div><strong>{disposition?.outcome ?? call.outcome ?? call.current_state}</strong><time>{new Date(call.requested_at).toLocaleString()}</time></div><span>{call.current_state} · {call.verified_duration_seconds === null ? "Duration unavailable" : `${Math.floor(call.verified_duration_seconds / 60)}m ${String(call.verified_duration_seconds % 60).padStart(2, "0")}s`}</span>{disposition?.note ? <p>{disposition.note}</p> : null}{disposition?.qualified ? <StatusBadge tone="success">Qualified</StatusBadge> : null}</div></article>; })}</div><nav className={styles.historyPagination} aria-label="Contact call history pages"><span>Page {callsPage} of {pageCount} · {callCount} records</span><div><a href={callPageHref(Math.max(1, callsPage - 1))} aria-disabled={callsPage <= 1}>Previous</a><a href={callPageHref(Math.min(pageCount, callsPage + 1))} aria-disabled={callsPage >= pageCount}>Next</a></div></nav></> : <EmptyState title="No call history" detail="No call records have been saved for this contact." icon={<AudioLines size={17} />} />}
      </section>
    </div>
    <section className={styles.profilePanel}>
      <header className={styles.panelHeader}><div><span className={styles.eyebrow}>ACTIVITY</span><h2>Latest recorded activity</h2></div><StatusBadge tone="neutral">{timeline.length} events</StatusBadge></header>
      {timeline.length ? <div className={styles.timeline}>{timeline.map((event) => <div className={styles.timelineItem} key={event.id}><i /><div><strong>{event.title}</strong><span>{event.detail}</span></div><time>{new Date(event.time).toLocaleString()}</time></div>)}</div> : <EmptyState title="No activity recorded" detail="Saved calls and callbacks will appear here chronologically." icon={<CalendarClock size={17} />} />}
    </section>
  </WorkspaceShell>;
}