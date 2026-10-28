import { notFound, redirect } from "next/navigation";
import { AudioLines, CalendarClock, Phone, UserRound } from "lucide-react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { EmptyState, StatusBadge } from "@/components/ui";
import { getCompanyContact, getOpenContactForAgent } from "@/lib/contacts";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/contacts/[id]/contact-profile.module.css";
import { recordAgentWorkActivity } from "@/lib/work-session-activity";
import AgentCallWorkflow from "@/app/contacts/[id]/agent-call-workflow";
import ContactEditor from "@/app/contacts/[id]/contact-editor";
import { listActiveAgentProfiles } from "@/lib/assignable-agents";
import { createCompanyCrmClient } from "@/lib/company-database";
import { getAgentContactFields, STANDARD_AGENT_CONTACT_FIELDS } from "@/lib/agent-contact-fields";
import { CallRecording } from "@/components/call-recording";

export const dynamic = "force-dynamic";

type CallRow = { id: string; agent_id: string; provider_call_id: string | null; current_state: string; requested_at: string; answered_at: string | null; ended_at: string | null; verified_duration_seconds: number | null; outcome: string | null };
type DispositionRow = { call_id: string; outcome: string; note: string | null; qualified: boolean; callback_at: string | null; created_at: string };
type CallbackRow = { id: string; due_at: string; timezone: string; status: string; completed_at: string | null };

export default async function ContactDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ message?: string; callsPage?: string; size?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.companyId || (session.isSuperAdmin && !session.isImpersonating)) redirect(session.isSuperAdmin ? "/super-admin" : "/login?access=denied");
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const callsPage = Math.max(1, Number(query.callsPage) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(query.size)) ? Number(query.size) : 25;

  const contact = await getCompanyContact(id, session.companyId);
  if (!contact) notFound();
  const visibleContactFields = session.role === "agent" ? await getAgentContactFields(session.companyId, session.id) : [];
  if (session.role === "agent") {
    const authorizedContact = await getOpenContactForAgent(id, session.companyId, session.id);
    if (!authorizedContact) notFound();
    await recordAgentWorkActivity();
  }
  const agentCanSee = new Set(visibleContactFields);
  const displayedContactName = session.role === "agent" && !agentCanSee.has("name") ? "Contact" : contact.name;
  const agentDetails = session.role === "agent" ? visibleContactFields.flatMap((fieldId) => {
    if (fieldId === "name" || fieldId === "phone" || fieldId === "status") return [];
    const standard = STANDARD_AGENT_CONTACT_FIELDS.find((item) => item.id === fieldId);
    const value = fieldId.startsWith("custom:")
      ? contact.customFields[fieldId.slice("custom:".length)]
      : fieldId === "lead_source" ? contact.leadSource : contact[fieldId as "email" | "subject" | "notes"];
    const text = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
    return text.trim() ? [{ id: fieldId, label: standard?.label ?? fieldId.slice("custom:".length), value: text }] : [];
  }) : [];

  let calls: CallRow[] = [];
  let dispositions: DispositionRow[] = [];
  let callbacks: CallbackRow[] = [];
  let callCount = 0;
  let agentName = contact.assignedUserId ? "Assigned agent" : "Unassigned";
  let assignedAgentNames: string[] = [];
  let activeAgents: Array<{ id: string; email: string }> = [];
  let historyAvailable = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { client: crm } = await createCompanyCrmClient(session.companyId);
    const [callResult, callbackResult, agentResult] = await Promise.all([
      crm.from("calls").select("id, agent_id, provider_call_id, current_state, requested_at, answered_at, ended_at, verified_duration_seconds, outcome", { count: "exact" }).eq("company_id", session.companyId).eq("internal_contact_id", id).order("requested_at", { ascending: false }).range((callsPage - 1) * pageSize, callsPage * pageSize - 1),
      crm.from("callbacks").select("id, due_at, timezone, status, completed_at").eq("company_id", session.companyId).eq("internal_contact_id", id).order("due_at", { ascending: false }).limit(50),
      contact.assignedAgentIds?.length
        ? supabase.from("profiles").select("id, normalized_email").in("id", contact.assignedAgentIds)
        : contact.assignedUserId
          ? supabase.from("profiles").select("id, normalized_email").eq("id", contact.assignedUserId)
          : Promise.resolve({ data: [], error: null }),
    ]);
    if (!callResult.error && !callbackResult.error) {
      calls = callResult.data ?? [];
      callCount = callResult.count ?? 0;
      callbacks = callbackResult.data ?? [];
      historyAvailable = true;
      const ids = calls.map((call) => call.id);
      if (ids.length) {
        const dispositionResult = await crm.from("call_dispositions").select("call_id, outcome, note, qualified, callback_at, created_at").eq("company_id", session.companyId).in("call_id", ids).order("created_at", { ascending: false });
        if (!dispositionResult.error) dispositions = (dispositionResult.data ?? []) as DispositionRow[];
      }
    }
    assignedAgentNames = (agentResult.data ?? []).map((agent) => agent.normalized_email);
    if (session.role === "admin" && assignedAgentNames.length) agentName = assignedAgentNames.join(", ");
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

  return <WorkspaceShell session={session} section="contacts" title={displayedContactName} subtitle={session.role === "admin" ? "Contact profile and saved history." : "Assigned contact details and saved activity."}>
    {query.message ? <div className={styles.notice} role="status">{query.message}</div> : null}
    <div className={styles.profileGrid}>
      <section className={styles.profilePanel}>
        <div className={styles.profileTop}><span className={styles.profileAvatar}>{displayedContactName.slice(0, 1).toUpperCase()}</span><div><span className={styles.eyebrow}>CONTACT</span><h2>{displayedContactName}</h2>{session.role === "admin" || agentCanSee.has("status") ? <StatusBadge tone={contact.isOpen ? "success" : contact.status ? "neutral" : "warning"}>{contact.status ?? "Unknown status"}</StatusBadge> : null}</div></div>
        {session.role === "agent" ? <div className={styles.agentContactInfo}>{agentCanSee.has("phone") ? <div><small>PHONE</small><span>{contact.maskedPhone}</span></div> : null}{agentDetails.map((field) => <div key={field.id}><small>{field.label}</small><span>{field.value}</span></div>)}</div> : <div className={styles.infoGrid}><div><small>PHONE</small><a href={contact.phone ? `tel:${contact.phone}` : undefined}><Phone size={13} /> {contact.phone ?? "Not available"}</a></div><div><small>EMAIL</small><span>{contact.email ?? "Not available"}</span></div><div><small>ASSIGNED AGENT</small><span><UserRound size={13} /> {agentName}</span></div><div><small>CONTACT ID</small><span className={styles.mono}>{contact.id}</span></div><div><small>SUBJECT</small><span>{contact.subject ?? "Not set"}</span></div></div>}
        {session.role === "agent" ? <AgentCallWorkflow contactId={contact.id} contactName={displayedContactName} /> : null}
        {session.role === "admin" ? <ContactEditor contact={{ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, status: contact.status, subject: contact.subject, notes: contact.notes, assignedAgentId: contact.assignedAgentId, assignedAgentIds: contact.assignedAgentIds }} agents={activeAgents} /> : null}
      </section>
      <section className={styles.profilePanel} id="call-history">
        <header className={styles.panelHeader}><div><span className={styles.eyebrow}>CALL HISTORY</span><h2>Saved calls</h2></div><StatusBadge tone="neutral">{callCount} records</StatusBadge></header>
        {!historyAvailable ? <EmptyState title="History unavailable" detail="Check database connectivity and permissions." icon={<AudioLines size={17} />} /> : calls.length ? <><div className={styles.historyList}>{calls.map((call) => { const disposition = latestDisposition.get(call.id); return <article className={styles.historyItem} key={call.id}><div className={styles.historyGlyph}><AudioLines size={15} /></div><div className={styles.historyBody}><div><strong>{disposition?.outcome ?? call.outcome ?? call.current_state}</strong><time>{new Date(call.requested_at).toLocaleString()}</time></div><span>{call.current_state} · {call.verified_duration_seconds === null ? "Duration unavailable" : `${Math.floor(call.verified_duration_seconds / 60)}m ${String(call.verified_duration_seconds % 60).padStart(2, "0")}s`}</span>{call.provider_call_id && (session.role === "admin" || call.agent_id === session.id) ? <CallRecording callId={call.id} /> : null}{disposition?.note ? <p>{disposition.note}</p> : null}{disposition?.qualified ? <StatusBadge tone="success">Qualified</StatusBadge> : null}</div></article>; })}</div><nav className={styles.historyPagination} aria-label="Contact call history pages"><span>Page {callsPage} of {pageCount} · {callCount} records</span><div><a href={callPageHref(Math.max(1, callsPage - 1))} aria-disabled={callsPage <= 1}>Previous</a><a href={callPageHref(Math.min(pageCount, callsPage + 1))} aria-disabled={callsPage >= pageCount}>Next</a></div></nav></> : <EmptyState title="No call history" detail="No call records have been saved for this contact." icon={<AudioLines size={17} />} />}
      </section>
    </div>
    <section className={styles.profilePanel}>
      <header className={styles.panelHeader}><div><span className={styles.eyebrow}>ACTIVITY</span><h2>Latest recorded activity</h2></div><StatusBadge tone="neutral">{timeline.length} events</StatusBadge></header>
      {timeline.length ? <div className={styles.timeline}>{timeline.map((event) => <div className={styles.timelineItem} key={event.id}><i /><div><strong>{event.title}</strong><span>{event.detail}</span></div><time>{new Date(event.time).toLocaleString()}</time></div>)}</div> : <EmptyState title="No activity recorded" detail="Saved calls and callbacks will appear here chronologically." icon={<CalendarClock size={17} />} />}
    </section>
  </WorkspaceShell>;
}