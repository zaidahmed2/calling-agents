import { redirect } from "next/navigation";
import { Clock3, Pause, Play, Timer } from "lucide-react";

import { EmptyState, StatusBadge } from "@/components/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/my-sessions/my-sessions.module.css";

export const dynamic = "force-dynamic";

type WorkSession = {
  id: string;
  started_at: string;
  ended_at: string | null;
  state_changed_at: string | null;
  last_activity_at: string | null;
  state: "active" | "paused" | "ended";
  active_seconds: number;
  idle_seconds: number;
  reason: string | null;
};

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function localDate(value: string) {
  return new Date(value).toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short" });
}

function currentTimestamp() {
  return Date.now();
}

function getEffectiveTime(item: WorkSession, now: number) {
  let activeSeconds = item.active_seconds;
  let idleSeconds = item.idle_seconds;
  let pendingIdle = false;

  if (item.state === "active") {
    const stateChangedAt = new Date(item.state_changed_at ?? item.started_at).getTime();
    const lastActivityAt = new Date(item.last_activity_at ?? item.state_changed_at ?? item.started_at).getTime();
    const idleElapsed = Math.max(0, Math.floor((now - lastActivityAt) / 1000));
    if (idleElapsed >= 60) {
      activeSeconds += Math.max(0, Math.floor((lastActivityAt - stateChangedAt) / 1000));
      idleSeconds += idleElapsed;
      pendingIdle = true;
    } else {
      activeSeconds += Math.max(0, Math.floor((now - stateChangedAt) / 1000));
    }
  }

  return { activeSeconds, idleSeconds, pendingIdle };
}

export default async function AgentSessionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "agent") redirect("/sessions");

  let sessions: WorkSession[] = [];
  let unavailable = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("work_sessions")
      .select("id, started_at, ended_at, state_changed_at, last_activity_at, state, active_seconds, idle_seconds, reason")
      .eq("agent_id", session.id)
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) unavailable = true;
    else sessions = (data ?? []) as WorkSession[];
  } catch {
    unavailable = true;
  }

  const snapshot = currentTimestamp();
  const timedSessions = sessions.map((item) => ({ ...item, time: getEffectiveTime(item, snapshot) }));
  const totalActive = timedSessions.reduce((total, item) => total + item.time.activeSeconds, 0);
  const totalIdle = timedSessions.reduce((total, item) => total + item.time.idleSeconds, 0);
  const current = timedSessions.find((item) => item.state === "active" || item.state === "paused");

  return <WorkspaceShell session={session} section="sessions" title="My sessions" subtitle="Your recorded work time, activity and idle periods.">
    <div className={styles.intro}><span>PERSONAL ACTIVITY</span><p>Session records are based on server timestamps and recorded work signals.</p></div>
    {unavailable ? <div className={styles.notice} role="alert"><strong>Session history is unavailable</strong><p>Check your connection and ask an administrator to apply pending database migrations.</p></div> : <>
      <div className={styles.summary}>
        <article><span className={styles.summaryIcon}><Clock3 size={17} /></span><div><small>SESSIONS</small><strong>{sessions.length}</strong><span>Latest 100 records</span></div></article>
        <article><span className={`${styles.summaryIcon} ${styles.activeIcon}`}><Play size={16} /></span><div><small>ACTIVE TIME</small><strong>{formatDuration(totalActive)}</strong><span>Recorded and current sessions</span></div></article>
        <article><span className={`${styles.summaryIcon} ${styles.idleIcon}`}><Pause size={16} /></span><div><small>IDLE TIME</small><strong>{formatDuration(totalIdle)}</strong><span>Not counted as active work</span></div></article>
      </div>
      {current ? <div className={styles.currentSession}><span className={styles.currentMark} /><div><small>CURRENT SESSION</small><strong>{current.time.pendingIdle ? "No recent activity recorded" : current.state === "active" ? "Session running" : "Session paused"}</strong><span>Started {localDate(current.started_at)}</span></div><StatusBadge tone={current.time.pendingIdle || current.state === "paused" ? "warning" : "success"}>{current.time.pendingIdle ? "Idle · pause pending" : current.state}</StatusBadge></div> : null}
      <section className={styles.timelinePanel}>
        <header className={styles.timelineHeader}><div><span>SESSION HISTORY</span><h2>Your sessions</h2></div><span>{sessions.length} records</span></header>
        {timedSessions.length ? <div className={styles.timeline}>{timedSessions.map((item) => {
          const tracked = item.time.activeSeconds + item.time.idleSeconds;
          const activeShare = tracked ? Math.round(item.time.activeSeconds / tracked * 100) : 0;
          const status = item.time.pendingIdle ? "Idle · pause pending" : item.state;
          const statusTone = item.time.pendingIdle || item.state === "paused" ? "warning" : item.state === "active" ? "success" : "neutral";
          return <article className={styles.session} key={item.id}>
            <div className={styles.rail}><i className={item.time.pendingIdle ? styles.idleDot : item.state === "active" ? styles.liveDot : styles.endedDot} /><span /></div>
            <div className={styles.sessionBody}>
              <div className={styles.sessionHeader}><div><strong>{item.state === "ended" ? "Completed session" : "Current session"}</strong><StatusBadge tone={statusTone}>{status}</StatusBadge></div><time>{localDate(item.started_at)}</time></div>
              <div className={styles.timeRange}><div><small>STARTED</small><strong>{new Date(item.started_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" })}</strong></div><span /><div><small>ENDED</small><strong>{item.ended_at ? new Date(item.ended_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Sydney" }) : "In progress"}</strong></div></div>
              <div className={styles.durationBlock}><div className={styles.durationBar} role="img" aria-label={`${formatDuration(item.time.activeSeconds)} active and ${formatDuration(item.time.idleSeconds)} idle`}><i style={{ width: `${activeShare}%` }} /><span style={{ width: `${100 - activeShare}%` }} /></div><div className={styles.legend}><span><i />Active <b>{formatDuration(item.time.activeSeconds)}</b></span><span><i />Idle <b>{formatDuration(item.time.idleSeconds)}</b></span></div></div>
              {item.reason ? <p className={styles.reason}><Timer size={12} />{item.reason}</p> : null}
            </div>
          </article>;
        })}</div> : <EmptyState title="No sessions yet" detail="When you start a work session, its recorded time will appear here." icon={<Clock3 size={18} />} />}
      </section>
    </>}
  </WorkspaceShell>;
}
