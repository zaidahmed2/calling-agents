import { redirect } from "next/navigation";
import { Activity, Clock3, LogIn, Pause, Play, Timer } from "lucide-react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { StatusBadge } from "@/components/ui";
import { AdminExportLink } from "@/components/admin-export-link";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { listCompanyAgentProfiles } from "@/lib/assignable-agents";
import styles from "@/app/sessions/page.module.css";

export const dynamic = "force-dynamic";

type WorkSessionRow = {
  id: string;
  agent_id: string;
  started_at: string;
  ended_at: string | null;
  state_changed_at: string | null;
  last_activity_at: string | null;
  state: "active" | "paused" | "ended" | "idle";
  idle_seconds: number;
  active_seconds: number;
  reason: string | null;
};

type WorkSessionEvent = {
  id: string;
  session_id: string | null;
  agent_id: string;
  event_type: "login" | "session_started" | "session_paused" | "session_resumed" | "session_ended";
  reason: string | null;
  occurred_at: string;
};

type TimelineItem = WorkSessionEvent & { legacy?: boolean };

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function describeEvent(event: TimelineItem) {
  if (event.legacy) {
    return event.event_type === "session_started" ? "Session started (recorded)" : "Session ended (recorded)";
  }
  switch (event.event_type) {
    case "login": return "Agent signed in";
    case "session_started": return "Work timer started";
    case "session_paused": return event.reason?.toLowerCase().includes("60 seconds") ? "Auto-paused after inactivity" : "Work timer paused";
    case "session_resumed": return "Work timer resumed";
    case "session_ended": return "Work timer ended";
  }
}

function eventIcon(type: TimelineItem["event_type"]) {
  if (type === "login") return <LogIn size={15} />;
  if (type === "session_started" || type === "session_resumed") return <Play size={15} />;
  if (type === "session_paused") return <Pause size={15} />;
  return <Clock3 size={15} />;
}

function eventTone(type: TimelineItem["event_type"]) {
  if (type === "login") return styles.loginTone;
  if (type === "session_paused") return styles.pauseTone;
  if (type === "session_ended") return styles.endTone;
  return styles.startTone;
}

export default async function WorkSessionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "super_admin" || !session.companyId) {
    redirect(session.isSuperAdmin ? "/super-admin" : "/login?access=denied");
  }
  if (!["admin", "agent"].includes(session.role)) redirect("/open-queue");

  const isAdmin = session.role === "admin";
  let sessions: WorkSessionRow[] = [];
  let events: WorkSessionEvent[] = [];
  let agents: Array<{ id: string; email: string; name: string; isActive: boolean }> = [];
  let unavailable = false;
  let eventHistoryUnavailable = false;

  try {
    const supabase = await createSupabaseServerClient();
    const sessionQuery = supabase.from("work_sessions")
      .select("id, agent_id, started_at, ended_at, state_changed_at, last_activity_at, state, idle_seconds, active_seconds, reason")
      .eq("company_id", session.companyId)
      .order("started_at", { ascending: false })
      .limit(100);
    const eventQuery = supabase.from("work_session_events")
      .select("id, session_id, agent_id, event_type, reason, occurred_at")
      .eq("company_id", session.companyId)
      .order("occurred_at", { ascending: false })
      .limit(500);

    const [sessionResult, eventResult] = await Promise.all([
      isAdmin ? sessionQuery : sessionQuery.eq("agent_id", session.id),
      isAdmin ? eventQuery : eventQuery.eq("agent_id", session.id),
    ]);
    if (sessionResult.error) unavailable = true;
    else sessions = (sessionResult.data ?? []) as WorkSessionRow[];
    if (eventResult.error) eventHistoryUnavailable = true;
    else events = (eventResult.data ?? []) as WorkSessionEvent[];

    if (isAdmin) {
      try {
        agents = await listCompanyAgentProfiles(session.companyId);
      } catch {
        eventHistoryUnavailable = true;
      }
    }
  } catch {
    unavailable = true;
  }

  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const eventsBySession = new Set(events.flatMap((event) => event.session_id ? [event.session_id] : []));
  const legacyEvents: TimelineItem[] = sessions.flatMap((item) => {
    if (eventsBySession.has(item.id)) return [];
    const inferred: TimelineItem[] = [{
      id: `${item.id}-legacy-start`,
      session_id: item.id,
      agent_id: item.agent_id,
      event_type: "session_started",
      reason: null,
      occurred_at: item.started_at,
      legacy: true,
    }];
    if (item.ended_at) {
      inferred.push({
        id: `${item.id}-legacy-end`,
        session_id: item.id,
        agent_id: item.agent_id,
        event_type: "session_ended",
        reason: item.reason,
        occurred_at: item.ended_at,
        legacy: true,
      });
    } else if (item.state === "paused" && item.state_changed_at) {
      inferred.push({
        id: `${item.id}-legacy-pause`,
        session_id: item.id,
        agent_id: item.agent_id,
        event_type: "session_paused",
        reason: item.reason,
        occurred_at: item.state_changed_at,
        legacy: true,
      });
    }
    return inferred;
  });
  const timeline: TimelineItem[] = [...events, ...legacyEvents]
    .sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at));
  const activeSessions = sessions.filter((item) => item.state === "active").length;
  const pausedSessions = sessions.filter((item) => item.state === "paused").length;
  const totalActiveSeconds = sessions.reduce((sum, item) => sum + item.active_seconds, 0);
  const totalIdleSeconds = sessions.reduce((sum, item) => sum + item.idle_seconds, 0);
  const eventCounts = events.reduce((counts, event) => {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);

  return (
    <WorkspaceShell
      session={session}
      section="sessions"
      title={isAdmin ? "Team session history" : "My session history"}
      subtitle={isAdmin ? "Review agent sign-ins, timer activity, pauses and recorded work time." : "Your sign-ins, timer activity and recorded work time."}
    >
      <div className={styles.page}>
        <section className={styles.panel}>
          <div className={styles.header}>
            <div><p className={styles.eyebrow}>{isAdmin ? "TEAM ACTIVITY" : "PERSONAL ACTIVITY"}</p><h2 className={styles.title}>Session timeline</h2></div>
            <div className={styles.headerActions}>
              {isAdmin ? <><AdminExportLink type="session-events" /><AdminExportLink type="sessions" /></> : null}
              <span className={`${styles.statusPill} ${isAdmin ? styles.adminPill : styles.agentPill}`}>{isAdmin ? "ADMIN" : "AGENT"}</span>
            </div>
          </div>

          {unavailable ? <div className={styles.notice} role="alert"><strong>Session records unavailable</strong><p>Check the company database connection and applied migrations.</p></div> : null}
          {eventHistoryUnavailable ? <div className={styles.notice} role="alert"><strong>Detailed event history needs a database update</strong><p>Apply migration <code>20261020_000019_agent_session_event_history.sql</code>. Sign-ins and pause/resume events are recorded from that point onward.</p></div> : null}

          {!unavailable ? <>
            <div className={styles.summary}>
              <article className={styles.metricCard}><span className={styles.metricIcon}><Activity size={17} /></span><div><small>RECORDED SESSIONS</small><strong>{sessions.length}</strong><span>Latest 100</span></div></article>
              {isAdmin ? <article className={styles.metricCard}><span className={`${styles.metricIcon} ${styles.loginIcon}`}><LogIn size={17} /></span><div><small>AGENT SIGN-INS</small><strong>{eventCounts.login ?? 0}</strong><span>Latest 500 events</span></div></article> : null}
              <article className={styles.metricCard}><span className={`${styles.metricIcon} ${styles.activeIcon}`}><Play size={16} /></span><div><small>ACTIVE TIMERS</small><strong>{activeSessions}</strong><span>{pausedSessions} paused</span></div></article>
              <article className={styles.metricCard}><span className={`${styles.metricIcon} ${styles.timeIcon}`}><Timer size={17} /></span><div><small>RECORDED ACTIVE TIME</small><strong>{formatDuration(totalActiveSeconds)}</strong><span>{formatDuration(totalIdleSeconds)} idle</span></div></article>
            </div>

            {isAdmin ? <section className={styles.agentPanel}>
              <header className={styles.sectionHeader}><div><span className={styles.sectionEyebrow}>TEAM OVERVIEW</span><h3>Agent activity</h3></div><span>{agents.length} agents</span></header>
              {agents.length ? <div className={styles.agentGrid}>{agents.map((agent) => {
                const agentSessions = sessions.filter((item) => item.agent_id === agent.id);
                const latestEvent = events.find((event) => event.agent_id === agent.id);
                const current = agentSessions.find((item) => item.state === "active" || item.state === "paused");
                return <article className={styles.agentCard} key={agent.id}>
                  <div className={styles.agentIdentity}><span className={styles.avatar}>{agent.email.slice(0, 1).toUpperCase()}</span><div><strong>{agent.name}</strong><small>{agent.email}</small></div></div>
                  <StatusBadge tone={current?.state === "active" ? "success" : current?.state === "paused" ? "warning" : "neutral"}>{current?.state ?? (agent.isActive ? "offline" : "inactive")}</StatusBadge>
                  <div className={styles.agentStats}><span>{agentSessions.length} sessions</span><span>{formatDuration(agentSessions.reduce((sum, item) => sum + item.active_seconds, 0))} active</span></div>
                  <small className={styles.lastSeen}>{latestEvent ? `Last activity ${formatDate(latestEvent.occurred_at)}` : "No sign-in events recorded yet"}</small>
                </article>;
              })}</div> : <p className={styles.emptyText}>No agents are assigned to this company yet.</p>}
            </section> : null}

            <section className={styles.timelinePanel}>
              <header className={styles.sectionHeader}>
                <div><span className={styles.sectionEyebrow}>AUDIT TRAIL</span><h3>{isAdmin ? "Sign-ins and session events" : "Your activity"}</h3></div>
                <span>{timeline.length} events</span>
              </header>
              {timeline.length ? <div className={styles.timeline}>
                {timeline.map((event) => {
                  const agent = agentById.get(event.agent_id);
                  return <article className={styles.event} key={event.id}>
                    <span className={`${styles.eventIcon} ${eventTone(event.event_type)}`}>{eventIcon(event.event_type)}</span>
                    <div className={styles.eventBody}>
                      <div className={styles.eventHeading}><strong>{describeEvent(event)}</strong><time dateTime={event.occurred_at}>{formatDate(event.occurred_at)}</time></div>
                      {isAdmin ? <span className={styles.eventAgent}>{agent?.email ?? "Company agent"}</span> : null}
                      {event.reason && !event.legacy ? <p>{event.reason}</p> : null}
                      {event.legacy ? <span className={styles.legacyTag}>Older session record · exact pause/sign-in events were not previously stored</span> : null}
                    </div>
                  </article>;
                })}
              </div> : <div className={styles.emptyState}><Clock3 size={20} /><strong>No session events recorded yet</strong><span>Agent sign-ins and timer actions will appear here as they happen.</span></div>}
            </section>

            <section className={styles.sessionPanel}>
              <header className={styles.sectionHeader}><div><span className={styles.sectionEyebrow}>WORK-TIME RECORDS</span><h3>Session totals</h3></div><span>{sessions.length} sessions</span></header>
              {sessions.length ? <div className={styles.tableWrap}><table className={styles.table}>
                <thead><tr>{isAdmin ? <th>Agent</th> : null}<th>Started</th><th>Ended</th><th>Status</th><th>Active</th><th>Idle</th></tr></thead>
                <tbody>{sessions.map((item) => <tr key={item.id}>
                  {isAdmin ? <td><strong>{agentById.get(item.agent_id)?.email ?? "Company agent"}</strong></td> : null}
                  <td>{formatDate(item.started_at)}</td>
                  <td>{item.ended_at ? formatDate(item.ended_at) : "—"}</td>
                  <td><StatusBadge tone={item.state === "active" ? "success" : item.state === "paused" ? "warning" : "neutral"}>{item.state}</StatusBadge></td>
                  <td>{formatDuration(item.active_seconds)}</td>
                  <td>{formatDuration(item.idle_seconds)}</td>
                </tr>)}</tbody>
              </table></div> : <p className={styles.emptyText}>No work-session records found for this company.</p>}
            </section>
            <p className={styles.policyNote}>Activity is based on recorded server timestamps. Timers automatically pause after 60 seconds without qualifying activity. This page displays the latest 100 sessions and 500 events.</p>
          </> : null}
        </section>
      </div>
    </WorkspaceShell>
  );
}
