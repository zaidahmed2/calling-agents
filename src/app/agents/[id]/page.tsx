import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ArrowUpRight, AudioLines, BadgeCheck, CalendarClock, ContactRound, Timer, UserRound } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getGhlContact } from "@/lib/ghl";
import { listOpenContactsForAgent } from "@/lib/ghl";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/agents/[id]/agent-detail.module.css";

export const dynamic = "force-dynamic";

type Profile = { id: string; normalized_email: string; ghl_user_id: string | null; is_active: boolean };
type CallRow = { id: string; ghl_contact_id: string; current_state: string; requested_at: string; ended_at: string | null; verified_duration_seconds: number | null; manual_duration_seconds: number | null; provider_call_id: string | null; call_source: string; outcome: string | null };
type Disposition = { call_id: string; outcome: string; note: string | null; qualified: boolean; callback_at: string | null; created_at: string };
type SessionRow = { id: string; started_at: string; ended_at: string | null; state: string; state_changed_at: string | null; last_activity_at: string | null; active_seconds: number; idle_seconds: number; reason: string | null };
type Assignment = { id: string; ghl_contact_id: string; from_ghl_user_id: string | null; to_ghl_user_id: string | null; created_at: string; actor_id: string };
type ContactCursor = { startAfter: string; startAfterId: string } | null;

function readContactHistory(value: string | undefined): ContactCursor[] {
  if (!value || value.length > 6000) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 40).map((item): ContactCursor => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return typeof record.startAfter === "string" && typeof record.startAfterId === "string"
        ? { startAfter: record.startAfter.slice(0, 200), startAfterId: record.startAfterId.slice(0, 200) }
        : null;
    });
  } catch {
    return [];
  }
}

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

export default async function AgentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<{ page?: string; sessionsPage?: string; assignmentsPage?: string; contactsAfter?: string; contactsAfterId?: string; contactsHistory?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  const page = Math.max(1, Number(query.page) || 1);
  const sessionsPage = Math.max(1, Number(query.sessionsPage) || 1);
  const assignmentsPage = Math.max(1, Number(query.assignmentsPage) || 1);
  const contactsHistory = readContactHistory(query.contactsHistory);
  const contactsCursor: ContactCursor = query.contactsAfter && query.contactsAfterId
    ? { startAfter: query.contactsAfter.slice(0, 200), startAfterId: query.contactsAfterId.slice(0, 200) }
    : null;
  const pageSize = 25;

  const supabase = await createSupabaseServerClient();
  const { data: profileData, error: profileError } = await supabase.from("profiles")
    .select("id, normalized_email, ghl_user_id, is_active")
    .eq("id", id).eq("app_role", "agent").maybeSingle();
  if (profileError) return <WorkspaceShell session={session} section="sessions" title="Agent details"><div className={styles.error}>Agent profile could not be loaded.</div></WorkspaceShell>;
  if (!profileData) notFound();
  const profile = profileData as Profile;

  const [callResult, sessionResult, assignmentCountResult, assignmentResult, callbackCountResult, assignedContactsResult] = await Promise.all([
    supabase.from("calls").select("id, ghl_contact_id, current_state, requested_at, ended_at, verified_duration_seconds, manual_duration_seconds, provider_call_id, call_source, outcome", { count: "exact" }).eq("agent_id", id).order("requested_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
    supabase.from("work_sessions").select("id, started_at, ended_at, state, state_changed_at, last_activity_at, active_seconds, idle_seconds, reason", { count: "exact" }).eq("agent_id", id).order("started_at", { ascending: false }).range((sessionsPage - 1) * pageSize, sessionsPage * pageSize - 1),
    supabase.from("contact_assignment_events").select("id", { count: "exact", head: true }).eq("to_ghl_user_id", profile.ghl_user_id),
    supabase.from("contact_assignment_events").select("id, ghl_contact_id, from_ghl_user_id, to_ghl_user_id, created_at, actor_id", { count: "exact" }).or(`from_ghl_user_id.eq.${profile.ghl_user_id ?? "__none__"},to_ghl_user_id.eq.${profile.ghl_user_id ?? "__none__"}`).order("created_at", { ascending: false }).range((assignmentsPage - 1) * pageSize, assignmentsPage * pageSize - 1),
    supabase.from("callbacks").select("id", { count: "exact", head: true }).eq("agent_id", id),
    profile.ghl_user_id
      ? listOpenContactsForAgent({ assignedUserId: profile.ghl_user_id, limit: 100, cursor: contactsCursor })
      : Promise.resolve(null),
  ]);

  const calls = (callResult.data ?? []) as CallRow[];
  const sessions = (sessionResult.data ?? []) as SessionRow[];
  const assignments = (assignmentResult.data ?? []) as Assignment[];
  const callIds = calls.map((call) => call.id);
  const [dispositionResult, contactRowsResult] = await Promise.all([
    callIds.length ? supabase.from("call_dispositions").select("call_id, outcome, note, qualified, callback_at, created_at").in("call_id", callIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    Promise.all([...new Set([...calls.map((call) => call.ghl_contact_id), ...assignments.map((event) => event.ghl_contact_id)])].map(async (contactId) => [contactId, await getGhlContact(contactId)] as const)),
  ]);
  const dispositions = (dispositionResult.data ?? []) as Disposition[];
  const contactNames = new Map(contactRowsResult.map(([contactId, contact]) => [contactId, contact?.name ?? `Contact ${contactId}`]));
  const agentNames = new Map<string, string>();
  const appNames = new Map<string, string>();
  const { data: profiles } = await supabase.from("profiles").select("id, normalized_email, ghl_user_id");
  for (const item of profiles ?? []) {
    appNames.set(item.id, item.normalized_email);
    if (item.ghl_user_id) agentNames.set(item.ghl_user_id, item.normalized_email);
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
  const contactNextCursor: ContactCursor = assignedContactsResult && !assignedContactsResult.blocked && assignedContactsResult.nextCursor?.startAfter && assignedContactsResult.nextCursor.startAfterId
    ? { startAfter: assignedContactsResult.nextCursor.startAfter, startAfterId: assignedContactsResult.nextCursor.startAfterId }
    : null;
  const contactPageHref = (cursor: ContactCursor, history: ContactCursor[]) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("sessionsPage", String(sessionsPage));
    params.set("assignmentsPage", String(assignmentsPage));
    if (cursor) {
      params.set("contactsAfter", cursor.startAfter);
      params.set("contactsAfterId", cursor.startAfterId);
    }
    if (history.length) params.set("contactsHistory", JSON.stringify(history));
    return `/agents/${encodeURIComponent(id)}?${params.toString()}`;
  };
  const toAgentLabel = (userId: string | null) => userId ? agentNames.get(userId) ?? "Other agent" : "Unassigned";

  return <WorkspaceShell session={session} section="sessions" title="Agent activity" subtitle="Performance, current queue, call outcomes and work sessions.">
    <div className={styles.pageIntro}><Link className={styles.backLink} href="/dashboard"><ArrowLeft size={15} /> Overview</Link><span>AGENT REPORT <i /> LIVE DATA</span></div>
    <section className={styles.profileHero}>
      <div className={styles.heroIdentity}>
        <div className={styles.heroAvatar}><UserRound size={25} /><span>{profile.is_active ? "" : "!"}</span></div>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}>CALLING TEAM · AGENT PROFILE</span><h2>{profile.normalized_email.split("@")[0]}</h2><p>{profile.normalized_email}</p></div>
      </div>
      <div className={styles.heroDetails}>
        <span className={profile.is_active ? styles.activePill : styles.inactivePill}><i />{profile.is_active ? "Active agent" : "Inactive agent"}</span>
        <span className={profile.ghl_user_id ? styles.mappingPill : styles.unmappedPill}><BadgeCheck size={13} />{profile.ghl_user_id ? "GHL linked" : "GHL not linked"}</span>
      </div>
    </section>
    <div className={styles.metrics}>
      <article className={styles.metricCalls}><i><AudioLines size={17} /></i><span>Saved calls</span><strong>{callCount}</strong><small>All recorded call entries</small></article>
      <article className={styles.metricQueue}><i><ContactRound size={17} /></i><span>Current open queue</span><strong>{assignedContactsResult && !assignedContactsResult.blocked ? assignedContactsResult.contacts.length : "—"}</strong><small>{assignedContactsResult && !assignedContactsResult.blocked ? "Contacts on this GHL page" : "GHL queue unavailable"}</small></article>
      <article className={styles.metricTime}><i><Timer size={17} /></i><span>Active time shown</span><strong>{Math.floor(activeSeconds / 3600)}h {Math.floor(activeSeconds % 3600 / 60)}m</strong><small>Across {sessions.length} sessions on this page</small></article>
      <article className={styles.metricCallbacks}><i><CalendarClock size={17} /></i><span>Callbacks</span><strong>{callbackCount}</strong><small>Scheduled for this agent</small></article>
    </div>
    {!profile.is_active ? <div className={styles.notice}>This agent profile is inactive.</div> : null}
    {manualCallCount > 0 ? <div className={styles.notice}>This period includes {manualCallCount} agent-reported call record(s). Their duration is not provider-verified.</div> : null}

    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><span className={styles.sectionEyebrow}>01 / CALL HISTORY</span><h2>Calls and outcomes</h2></div><span className={styles.sectionCount}>{callCount} total records</span></header>
      {callResult.error || dispositionResult.error ? <div className={styles.error}>Call history could not be loaded.</div> : calls.length ? <div className={styles.tableScroll}><table><thead><tr><th>CONTACT</th><th>STARTED</th><th>ENDED</th><th>DURATION</th><th>OUTCOME</th><th>COMMENTS</th><th>RECORD TYPE</th></tr></thead><tbody>{calls.map((call) => {
        const disposition = latestDisposition.get(call.id);
        const seconds = call.manual_duration_seconds ?? call.verified_duration_seconds;
        return <tr key={call.id}><td>{contactNames.get(call.ghl_contact_id)}</td><td>{new Date(call.requested_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</td><td>{call.ended_at ? new Date(call.ended_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" }) : "—"}</td><td>{duration(seconds)}{call.verified_duration_seconds !== null ? <small>Provider verified duration</small> : call.provider_call_id ? <small>Crazytel SIP · duration agent-reported</small> : call.manual_duration_seconds !== null ? <small>Agent-reported duration</small> : null}</td><td>{disposition?.outcome ?? call.outcome ?? call.current_state}{disposition?.callback_at ? <small>Callback {new Date(disposition.callback_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</small> : null}</td><td className={styles.comment}>{disposition?.note ?? "—"}</td><td>{call.provider_call_id ? "Crazytel WebRTC" : call.call_source === "agent_reported" ? "Agent reported" : "Provider"}</td></tr>;
      })}</tbody></table><nav className={styles.pagination}><span>Page {page} of {pageCount} · {callCount} calls</span><div><Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1}>Previous</Link><Link href={pageHref(Math.min(pageCount, page + 1))} aria-disabled={page >= pageCount}>Next</Link></div></nav></div> : <EmptyState title="No saved calls" detail="Completed agent call reports and provider calls will appear here." icon={<AudioLines size={18} />} />}
    </section>

    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><span className={styles.sectionEyebrow}>02 / LIVE GHL QUEUE</span><h2>Current assigned contacts</h2></div><span className={styles.sectionCount}>{assignedContactsResult && !assignedContactsResult.blocked ? `${assignedContactsResult.contacts.length} on this page` : "Current list unavailable"}</span></header>
      {!profile.ghl_user_id ? <div className={styles.notice}>This agent profile is not linked to a GHL user, so its current contact queue cannot be matched.</div> : assignedContactsResult?.blocked ? <div className={styles.error}>Current assigned contacts could not be loaded from GHL. {assignedContactsResult.blocker}</div> : assignedContactsResult?.contacts.length ? <><div className={styles.tableScroll}><table><thead><tr><th>CONTACT</th><th>SUBURB</th><th>PHONE</th><th>STATUS</th><th /></tr></thead><tbody>{assignedContactsResult.contacts.map((contact) => <tr key={contact.id}><td>{contact.name}</td><td>{contact.suburb ?? "—"}</td><td>{contact.maskedPhone}</td><td>{contact.status}</td><td><Link href={`/contacts/${encodeURIComponent(contact.id)}`} aria-label={`Open ${contact.name}`}><ArrowUpRight size={15} /></Link></td></tr>)}</tbody></table></div><nav className={styles.pagination}><span>GHL contact page {contactsHistory.length + 1}</span><div>{contactsHistory.length ? <Link href={contactPageHref(contactsHistory.at(-1) ?? null, contactsHistory.slice(0, -1))}>Previous contacts</Link> : null}{contactNextCursor ? <Link href={contactPageHref(contactNextCursor, [...contactsHistory, contactsCursor])}>Next contacts</Link> : null}</div></nav></> : <><EmptyState title="No current Open contacts" detail="Contacts appear here when GHL assigns them to this agent and their status matches the agent queue." icon={<ContactRound size={18} />} />{contactNextCursor ? <nav className={styles.pagination}><span>GHL contact page {contactsHistory.length + 1}</span><div><Link href={contactPageHref(contactNextCursor, [...contactsHistory, contactsCursor])}>Next contacts</Link></div></nav> : null}</>}
    </section>

    <section className={styles.panel}>
      <header className={styles.panelHeader}><div><span className={styles.sectionEyebrow}>03 / ASSIGNMENT AUDIT</span><h2>Contact assignment history</h2></div><span className={styles.sectionCount}>{assignmentHistoryUnavailable ? "Unavailable" : `${assignmentTotal} assigned to agent`}</span></header>
      {assignmentHistoryUnavailable ? <div className={styles.notice}>Assignment history is not available. Apply migration 20261011_000008_contact_assignment_history.sql. History begins when that migration is active; older GHL changes are not backfilled.</div> : assignments.length ? <><div className={styles.assignmentList}>{assignments.map((event) => <article key={event.id}><div><strong>{contactNames.get(event.ghl_contact_id)}</strong><time>{new Date(event.created_at).toLocaleString()}</time></div><p>{toAgentLabel(event.from_ghl_user_id)} <span>→</span> {toAgentLabel(event.to_ghl_user_id)}</p><small>Changed by {appNames.get(event.actor_id) ?? "Administrator"}</small></article>)}</div><nav className={styles.pagination}><span>Page {assignmentsPage} of {assignmentsPageCount} · {assignmentsHistoryCount} history events</span><div><Link href={pageHref(Math.max(1, assignmentsPage - 1), "assignments")} aria-disabled={assignmentsPage <= 1}>Previous</Link><Link href={pageHref(Math.min(assignmentsPageCount, assignmentsPage + 1), "assignments")} aria-disabled={assignmentsPage >= assignmentsPageCount}>Next</Link></div></nav></> : <EmptyState title="No assignments recorded" detail="Assignment events made through Terraverse after history tracking is enabled appear here." icon={<ContactRound size={18} />} />}
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
