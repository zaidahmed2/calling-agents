import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, AudioLines, BadgeCheck, CalendarClock, ContactRound, Timer, UserRound } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getCompanyContact, listContactsForAgent } from "@/lib/contacts";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/agents/[id]/agent-detail.module.css";
import { createCompanyCrmClient } from "@/lib/company-database";
import AgentContactAccess from "@/app/agents/[id]/agent-contact-access";
import AgentCrazytelAssignment from "@/app/agents/[id]/agent-crazytel-assignment";
import AgentVoiceAlert from "@/app/agents/[id]/agent-voice-alert";
import { CallRecording } from "@/components/call-recording";

export const dynamic = "force-dynamic";

type Profile = { id: string; normalized_email: string; ghl_user_id: string | null; is_active: boolean };
type CallRow = { id: string; ghl_contact_id: string; internal_contact_id: string | null; current_state: string; requested_at: string; ended_at: string | null; verified_duration_seconds: number | null; manual_duration_seconds: number | null; provider_call_id: string | null; call_source: string; outcome: string | null };
type Disposition = { call_id: string; outcome: string; note: string | null; qualified: boolean; callback_at: string | null; created_at: string };
type SessionRow = { id: string; started_at: string; ended_at: string | null; state: string; state_changed_at: string | null; last_activity_at: string | null; active_seconds: number; idle_seconds: number; reason: string | null };
type Assignment = { id: string; internal_contact_id: string | null; from_agent_id: string | null; to_agent_id: string | null; created_at: string; actor_id: string };

function duration(seconds: number | null) {
  if (seconds === null) return "Not recorded";
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function currentTimestamp() {
  return Date.now();
}

function getSessionTime(item: SessionRow, now: number) {
  let activeSeconds = item.active_seconds;
  let idleSeconds = item.idle_seconds;
  let idlePausePending = false;

  if (item.state === "active") {
    const stateChangedAt = new Date(item.state_changed_at ?? item.started_at).getTime();
    const lastActivityAt = new Date(item.last_activity_at ?? item.state_changed_at ?? item.started_at).getTime();
    const idleElapsed = Math.max(0, Math.floor((now - lastActivityAt) / 1000));
    if (idleElapsed >= 60) {
      activeSeconds += Math.max(0, Math.floor((lastActivityAt - stateChangedAt) / 1000));
      idleSeconds += idleElapsed;
      idlePausePending = true;
    } else {
      activeSeconds += Math.max(0, Math.floor((now - stateChangedAt) / 1000));
    }
  }

  return { activeSeconds, idleSeconds, idlePausePending };
}

export default async function AgentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ page?: string; sessionsPage?: string; assignmentsPage?: string; contactsAfter?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");
  const { id } = await params;
  if (!session.companyId) redirect("/login?access=denied");
  const query = searchParams ? await searchParams : {};
  const page = Math.max(1, Number(query.page) || 1);
  const sessionsPage = Math.max(1, Number(query.sessionsPage) || 1);
  const assignmentsPage = Math.max(1, Number(query.assignmentsPage) || 1);
  const contactsOffset = Math.max(0, Number(query.contactsAfter) || 0);
  const pageSize = 25;

  const supabase = await createSupabaseServerClient();
  const { client: crm } = await createCompanyCrmClient(session.companyId);
  const { data: membership } = await supabase.from("company_memberships").select("profile_id")
    .eq("profile_id", id).eq("company_id", session.companyId).eq("role", "agent").eq("is_active", true).maybeSingle();
  if (!membership) notFound();
  const { data: profileData, error: profileError } = await supabase.from("profiles")
    .select("id, normalized_email, ghl_user_id, is_active")
    .eq("id", id).eq("app_role", "agent").maybeSingle();
  if (profileError) return <WorkspaceShell session={session} section="agents" title="Agent details"><div className={styles.error}>Agent profile could not be loaded.</div></WorkspaceShell>;
  if (!profileData) notFound();
  const profile = profileData as Profile;

  const [callResult, sessionResult, assignmentCountResult, assignmentResult, callbackCountResult, assignedContactsResult] = await Promise.all([
    crm.from("calls").select("id, ghl_contact_id, internal_contact_id, current_state, requested_at, ended_at, verified_duration_seconds, manual_duration_seconds, provider_call_id, call_source, outcome", { count: "exact" }).eq("company_id", session.companyId).eq("agent_id", id).order("requested_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
    supabase.from("work_sessions").select("id, started_at, ended_at, state, state_changed_at, last_activity_at, active_seconds, idle_seconds, reason", { count: "exact" }).eq("company_id", session.companyId).eq("agent_id", id).order("started_at", { ascending: false }).range((sessionsPage - 1) * pageSize, sessionsPage * pageSize - 1),
    crm.from("contact_assignment_events").select("id", { count: "exact", head: true }).eq("company_id", session.companyId).eq("to_agent_id", id),
    crm.from("contact_assignment_events").select("id, internal_contact_id, from_agent_id, to_agent_id, created_at, actor_id", { count: "exact" }).eq("company_id", session.companyId).or(`from_agent_id.eq.${id},to_agent_id.eq.${id}`).order("created_at", { ascending: false }).range((assignmentsPage - 1) * pageSize, assignmentsPage * pageSize - 1),
    crm.from("callbacks").select("id", { count: "exact", head: true }).eq("company_id", session.companyId).eq("agent_id", id),
    listContactsForAgent({ companyId: session.companyId, agentId: id, limit: 100, offset: contactsOffset }),
  ]);

  const calls = (callResult.data ?? []) as CallRow[];
  const sessions = (sessionResult.data ?? []) as SessionRow[];
  const assignments = (assignmentResult.data ?? []) as Assignment[];
  const callIds = calls.map((call) => call.id);
  const [dispositionResult, contactRowsResult] = await Promise.all([
    callIds.length ? crm.from("call_dispositions").select("call_id, outcome, note, qualified, callback_at, created_at").eq("company_id", session.companyId).in("call_id", callIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    Promise.all([...new Set([...calls.flatMap((call) => call.internal_contact_id ? [call.internal_contact_id] : []), ...assignments.flatMap((event) => event.internal_contact_id ? [event.internal_contact_id] : [])])].map(async (contactId) => [contactId, session.companyId ? await getCompanyContact(contactId, session.companyId) : null] as const)),
  ]);
  const dispositions = (dispositionResult.data ?? []) as Disposition[];
  const contactNames = new Map(contactRowsResult.map(([contactId, contact]) => [contactId, contact?.name ?? `Contact ${contactId}`]));
  const agentNames = new Map<string, string>();
  const appNames = new Map<string, string>();
  const { data: profiles } = await supabase.from("profiles").select("id, normalized_email, ghl_user_id");
  for (const item of profiles ?? []) {
    appNames.set(item.id, item.normalized_email);
    agentNames.set(item.id, item.normalized_email);
  }
  const latestDisposition = new Map<string, Disposition>();
  for (const disposition of dispositions) if (!latestDisposition.has(disposition.call_id)) latestDisposition.set(disposition.call_id, disposition);

  const callCount = callResult.count ?? 0;
  const manualCallCount = calls.filter((call) => call.call_source === "agent_reported").length;
  const sessionSnapshotAt = currentTimestamp();
  const sessionTimes = new Map(sessions.map((item) => [item.id, getSessionTime(item, sessionSnapshotAt)]));
  const activeSeconds = [...sessionTimes.values()].reduce((sum, item) => sum + item.activeSeconds, 0);
  const callbackCount = callbackCountResult.count ?? 0;
  const assignmentHistoryUnavailable = Boolean(assignmentResult.error || assignmentCountResult.error);
  const assignmentTotal = assignmentCountResult.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(callCount / pageSize));
  const sessionsCount = sessionResult.count ?? 0;
  const assignmentsHistoryCount = assignmentResult.count ?? 0;
  const sessionsPageCount = Math.max(1, Math.ceil(sessionsCount / pageSize));
  const assignmentsPageCount = Math.max(1, Math.ceil(assignmentsHistoryCount / pageSize));
  const pageHref = (nextPage: number, kind: "calls" | "sessions" | "assignments" = "calls") => {
    const params = new URLSearchParams();
    params.set("page", String(kind === "calls" ? nextPage : page));
    params.set("sessionsPage", String(kind === "sessions" ? nextPage : sessionsPage));
    params.set("assignmentsPage", String(kind === "assignments" ? nextPage : assignmentsPage));
    return `/agents/${encodeURIComponent(id)}?${params.toString()}`;
  };
  const contactNextOffset = assignedContactsResult.nextOffset;
  const contactPageHref = (offset: number) => `/agents/${encodeURIComponent(id)}?page=${page}&sessionsPage=${sessionsPage}&assignmentsPage=${assignmentsPage}&contactsAfter=${offset}`;
  const toAgentLabel = (userId: string | null) => userId ? agentNames.get(userId) ?? "Other agent" : "Unassigned";

  return <WorkspaceShell session={session} section="agents" title="Agent activity" subtitle="Performance, current queue, call outcomes and work sessions.">
    <div className={styles.pageIntro}><Link className={styles.backLink} href="/dashboard"><ArrowLeft size={15} /> Overview</Link><span>AGENT REPORT <i /> LIVE DATA</span></div>
    <section className={styles.profileHero}>
      <div className={styles.heroIdentity}>
        <div className={styles.heroAvatar}><UserRound size={25} /><span>{profile.is_active ? "" : "!"}</span></div>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}>CALLING TEAM · AGENT PROFILE</span><h2>{profile.normalized_email.split("@")[0]}</h2><p>{profile.normalized_email}</p></div>
      </div>
      <div className={styles.heroDetails}>
        <span className={profile.is_active ? styles.activePill : styles.inactivePill}><i />{profile.is_active ? "Active agent" : "Inactive agent"}</span>
        <span className={profile.is_active ? styles.mappingPill : styles.unmappedPill}><BadgeCheck size={13} />{profile.is_active ? "Company member" : "Inactive"}</span>
      </div>
    </section>
    <div className={styles.metrics}>
      <article className={styles.metricCalls}><i><AudioLines size={17} /></i><span>Saved calls</span><strong>{callCount}</strong><small>All recorded call entries</small></article>
      <article className={styles.metricQueue}><i><ContactRound size={17} /></i><span>Current open queue</span><strong>{assignedContactsResult.contacts.length}</strong><small>Internal company contacts</small></article>
      <article className={styles.metricTime}><i><Timer size={17} /></i><span>Active time shown</span><strong>{Math.floor(activeSeconds / 3600)}h {Math.floor(activeSeconds % 3600 / 60)}m</strong><small>Across {sessions.length} sessions on this page</small></article>
      <article className={styles.metricCallbacks}><i><CalendarClock size={17} /></i><span>Callbacks</span><strong>{callbackCount}</strong><small>Scheduled for this agent</small></article>
    </div>
    {!profile.is_active ? <div className={styles.notice}>This agent profile is inactive.</div> : null}
    {manualCallCount > 0 ? <div className={styles.notice}>This period includes {manualCallCount} agent-reported call record(s). Their duration is not provider-verified.</div> : null}
    <AgentCrazytelAssignment agentId={id} />
    <AgentContactAccess agentId={id} />
    <AgentVoiceAlert agentId={id} />

    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><span className={styles.sectionEyebrow}>01 / CALL HISTORY</span><h2>Calls and outcomes</h2></div><span className={styles.sectionCount}>{callCount} total records</span></header>
      {callResult.error || dispositionResult.error ? <div className={styles.error}>Call history could not be loaded.</div> : calls.length ? <div className={styles.tableScroll}><table><thead><tr><th>CONTACT</th><th>STARTED</th><th>ENDED</th><th>DURATION</th><th>OUTCOME</th><th>COMMENTS</th><th>RECORD TYPE</th><th>RECORDING</th></tr></thead><tbody>{calls.map((call) => {
        const disposition = latestDisposition.get(call.id);
        const seconds = call.manual_duration_seconds ?? call.verified_duration_seconds;
        return <tr key={call.id}><td>{contactNames.get(call.ghl_contact_id)}</td><td>{new Date(call.requested_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</td><td>{call.ended_at ? new Date(call.ended_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" }) : "—"}</td><td>{duration(seconds)}{call.verified_duration_seconds !== null ? <small>Provider verified duration</small> : call.provider_call_id ? <small>Crazytel SIP · duration agent-reported</small> : call.manual_duration_seconds !== null ? <small>Agent-reported duration</small> : null}</td><td>{disposition?.outcome ?? call.outcome ?? call.current_state}{disposition?.callback_at ? <small>Callback {new Date(disposition.callback_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</small> : null}</td><td className={styles.comment}>{disposition?.note ?? "—"}</td><td>{call.provider_call_id ? "Crazytel WebRTC" : call.call_source === "agent_reported" ? "Agent reported" : "Provider"}</td><td>{call.provider_call_id ? <CallRecording callId={call.id} /> : "—"}</td></tr>;
      })}</tbody></table><nav className={styles.pagination}><span>Page {page} of {pageCount} · {callCount} calls</span><div><Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1}>Previous</Link><Link href={pageHref(Math.min(pageCount, page + 1))} aria-disabled={page >= pageCount}>Next</Link></div></nav></div> : <EmptyState title="No saved calls" detail="Completed agent call reports and provider calls will appear here." icon={<AudioLines size={18} />} />}
    </section>

    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><span className={styles.sectionEyebrow}>02 / COMPANY CRM</span><h2>Current assigned contacts</h2></div><span className={styles.sectionCount}>{assignedContactsResult.contacts.length} on this page</span></header>
      {assignedContactsResult.contacts.length ? <><div className={styles.tableScroll}><table><thead><tr><th>CONTACT</th><th>VISIBLE DETAILS</th><th>PHONE</th><th>STATUS</th><th /></tr></thead><tbody>{assignedContactsResult.contacts.map((contact) => <tr key={contact.id}><td>{contact.name}</td><td>{contact.details.length ? contact.details.map((field) => `${field.label}: ${field.value}`).join(" · ") : "—"}</td><td>{contact.phoneVisible ? contact.maskedPhone : "Hidden"}</td><td>{contact.status ?? "Hidden"}</td><td><Link href={`/contacts/${encodeURIComponent(contact.id)}`} aria-label={`Open ${contact.name}`}><ArrowUpRight size={15} /></Link></td></tr>)}</tbody></table></div>{contactNextOffset !== null ? <nav className={styles.pagination}><span>Contacts page {Math.floor(contactsOffset / 100) + 1}</span><Link href={contactPageHref(contactNextOffset)}>Next contacts</Link></nav> : null}</> : <EmptyState title="No current Open contacts" detail="Contacts appear here when assigned to this agent and marked Open in the company CRM." icon={<ContactRound size={18} />} />}
    </section>

    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><span className={styles.sectionEyebrow}>03 / ASSIGNMENT AUDIT</span><h2>Contact assignment history</h2></div><span className={styles.sectionCount}>{assignmentHistoryUnavailable ? "Unavailable" : `${assignmentTotal} assigned to agent`}</span></header>
      {assignmentHistoryUnavailable ? <div className={styles.notice}>Company assignment history is unavailable. Apply the company foundation migration.</div> : assignments.length ? <><div className={styles.assignmentList}>{assignments.map((event) => <article key={event.id}><div><strong>{event.internal_contact_id ? contactNames.get(event.internal_contact_id) : "Legacy assignment"}</strong><time>{new Date(event.created_at).toLocaleString()}</time></div><p>{toAgentLabel(event.from_agent_id)} <span>→</span> {toAgentLabel(event.to_agent_id)}</p><small>Changed by {appNames.get(event.actor_id) ?? "Administrator"}</small></article>)}</div><nav className={styles.pagination}><span>Page {assignmentsPage} of {assignmentsPageCount} · {assignmentsHistoryCount} history events</span><div><Link href={pageHref(Math.max(1, assignmentsPage - 1), "assignments")} aria-disabled={assignmentsPage <= 1}>Previous</Link><Link href={pageHref(Math.min(assignmentsPageCount, assignmentsPage + 1), "assignments")} aria-disabled={assignmentsPage >= assignmentsPageCount}>Next</Link></div></nav></> : <EmptyState title="No assignments recorded" detail="Company contact assignments will appear here." icon={<ContactRound size={18} />} />}
    </section>

    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><span className={styles.sectionEyebrow}>04 / WORK SESSIONS</span><h2>Session timeline</h2></div><span className={styles.sectionCount}>{sessionResult.count ?? sessions.length} sessions total</span></header>
      {sessionResult.error ? <div className={styles.error}>Work sessions could not be loaded.</div> : sessions.length ? <><div className={styles.sessionList}>{sessions.map((item) => {
        const time = sessionTimes.get(item.id) ?? { activeSeconds: item.active_seconds, idleSeconds: item.idle_seconds, idlePausePending: false };
        const trackedSeconds = time.activeSeconds + time.idleSeconds;
        const activeShare = trackedSeconds ? Math.round(time.activeSeconds / trackedSeconds * 100) : 0;
        const isOpen = !item.ended_at && item.state !== "ended";
        return <article className={styles.sessionItem} key={item.id}>
          <div className={styles.sessionRail}><i className={time.idlePausePending ? styles.sessionDotIdle : isOpen ? styles.sessionDotLive : styles.sessionDotEnded} /><span /></div>
          <div className={styles.sessionContent}>
            <div className={styles.sessionTopline}><div><strong>{isOpen ? "Current session" : "Completed session"}</strong><span className={time.idlePausePending ? styles.sessionIdle : item.state === "active" ? styles.sessionLive : styles.sessionEnded}>{time.idlePausePending ? "Idle · pause pending" : item.state}</span></div><time>{new Date(item.started_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</time></div>
            <div className={styles.sessionTimes}><span><small>STARTED</small><b>{new Date(item.started_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" })}</b></span><span className={styles.sessionConnector} /><span><small>ENDED</small><b>{item.ended_at ? new Date(item.ended_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" }) : "In progress"}</b></span></div>
            <div className={styles.sessionBreakdown}><div className={styles.sessionBar} role="img" aria-label={`${time.activeSeconds} active seconds and ${time.idleSeconds} idle seconds`}><i style={{ width: `${activeShare}%` }} /><span style={{ width: `${100 - activeShare}%` }} /></div><div><span><i className={styles.activeLegend} />Active <b>{duration(time.activeSeconds)}</b></span><span><i className={styles.idleLegend} />Idle <b>{duration(time.idleSeconds)}</b></span></div></div>
            {item.reason ? <p className={styles.sessionReason}>{item.reason}</p> : null}
          </div>
        </article>;
      })}</div><nav className={styles.pagination}><span>Page {sessionsPage} of {sessionsPageCount} · {sessionsCount} sessions</span><div><Link href={pageHref(Math.max(1, sessionsPage - 1), "sessions")} aria-disabled={sessionsPage <= 1}>Previous</Link><Link href={pageHref(Math.min(sessionsPageCount, sessionsPage + 1), "sessions")} aria-disabled={sessionsPage >= sessionsPageCount}>Next</Link></div></nav></> : <EmptyState title="No recorded sessions" detail="Started and completed timer sessions will appear here." icon={<Timer size={18} />} />}
    </section>
  </WorkspaceShell>;
}
