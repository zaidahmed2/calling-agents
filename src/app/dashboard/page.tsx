import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, ArrowDownRight, ArrowUpRight, AudioLines, CalendarClock, ContactRound, UserRoundCheck, UserRoundX } from "lucide-react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { EmptyState, StatusBadge } from "@/components/ui";
import { listGhlContactsPage } from "@/lib/ghl";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/dashboard/page.module.css";

export const dynamic = "force-dynamic";

type AgentRow = { id: string; normalized_email: string; ghl_user_id: string | null };
type CallRow = { id: string; agent_id: string; ghl_contact_id: string; current_state: string; requested_at: string; answered_at: string | null; verified_duration_seconds: number | null; outcome: string | null };
type CallbackRow = { id: string; contact_id: string; agent_id: string; due_at: string; status: string };
type SessionRow = { agent_id: string; state: string; started_at: string };
type ActivityRow = { id: string; event_type: string; created_at: string };

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export default async function DashboardPage({ searchParams }: { searchParams?: Promise<{ range?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");
  const query = searchParams ? await searchParams : {};
  const rangeDays = [7, 30, 90].includes(Number(query.range)) ? Number(query.range) : 7;
  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - rangeDays + 1);
  since.setHours(0, 0, 0, 0);

  let available = false;
  let agents: AgentRow[] = [];
  let calls: CallRow[] = [];
  let callbacks: CallbackRow[] = [];
  let sessions: SessionRow[] = [];
  let activity: ActivityRow[] = [];
  let callsTotal: number | null = null;
  let callStates: Record<string, number | null> = { answered: null, failed: null };
  let callbacksDueCount: number | null = null;
  let callbacksOverdueCount: number | null = null;
  let contactsPage: Awaited<ReturnType<typeof listGhlContactsPage>> | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const [agentResult, sessionResult, recentCallsResult, callbackResult, activityResult, allCallsCount, answeredCount, failedCount, dueCount, overdueCount] = await Promise.all([
      supabase.from("profiles").select("id, normalized_email, ghl_user_id").eq("app_role", "agent").eq("is_active", true).order("normalized_email"),
      supabase.from("work_sessions").select("agent_id, state, started_at").in("state", ["active", "paused"]),
      supabase.from("calls").select("id, agent_id, ghl_contact_id, current_state, requested_at, answered_at, verified_duration_seconds, outcome").gte("requested_at", since.toISOString()).order("requested_at", { ascending: false }).limit(1000),
      supabase.from("callbacks").select("id, contact_id, agent_id, due_at, status").in("status", ["scheduled", "due", "missed"]).order("due_at", { ascending: true }).limit(100),
      supabase.from("activity_logs").select("id, event_type, created_at").order("created_at", { ascending: false }).limit(8),
      supabase.from("calls").select("id", { count: "exact", head: true }),
      supabase.from("calls").select("id", { count: "exact", head: true }).or("current_state.eq.answered,and(current_state.eq.completed,answered_at.not.is.null)"),
      supabase.from("calls").select("id", { count: "exact", head: true }).eq("current_state", "failed"),
      supabase.from("callbacks").select("id", { count: "exact", head: true }).in("status", ["scheduled", "due", "missed"]).lte("due_at", now.toISOString()),
      supabase.from("callbacks").select("id", { count: "exact", head: true }).in("status", ["scheduled", "due", "missed"]).lt("due_at", now.toISOString()),
    ]);
    const results = [agentResult, sessionResult, recentCallsResult, callbackResult, activityResult, allCallsCount, answeredCount, failedCount, dueCount, overdueCount];
    available = !results.some((result) => result.error);
    if (available) {
      agents = agentResult.data ?? [];
      sessions = sessionResult.data ?? [];
      calls = recentCallsResult.data ?? [];
      callbacks = callbackResult.data ?? [];
      activity = activityResult.data ?? [];
      callsTotal = allCallsCount.count;
      callStates = { answered: answeredCount.count, failed: failedCount.count };
      callbacksDueCount = dueCount.count;
      callbacksOverdueCount = overdueCount.count;
    }
  } catch {
    available = false;
  }

  contactsPage = await listGhlContactsPage({ limit: 100 });
  const contacts = contactsPage.blocked ? [] : contactsPage.contacts;
  const contactCounts = {
    open: contacts.filter((contact) => contact.isOpen).length,
    assigned: contacts.filter((contact) => Boolean(contact.assignedUserId)).length,
    unassigned: contacts.filter((contact) => !contact.assignedUserId).length,
  };
  const openCallbacks = callbacks.filter((item) => item.status === "scheduled" || item.status === "due");
  const overdueCallbacks = openCallbacks.filter((item) => new Date(item.due_at).getTime() < now.getTime());

  const chartDays = Array.from({ length: rangeDays }, (_, index) => {
    const date = new Date(since);
    date.setDate(since.getDate() + index);
    return { key: dayKey(date), label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }), count: 0, answered: 0, failed: 0 };
  });
  const chartByDay = new Map(chartDays.map((item) => [item.key, item]));
  for (const call of calls) {
    const bucket = chartByDay.get(dayKey(new Date(call.requested_at)));
    if (!bucket) continue;
    bucket.count += 1;
    if (call.current_state === "answered" || (call.current_state === "completed" && call.answered_at)) bucket.answered += 1;
    if (call.current_state === "failed") bucket.failed += 1;
  }
  const maxDailyCalls = Math.max(1, ...chartDays.map((item) => item.count));
  const agentPerformance = agents.map((agent) => ({
    ...agent,
    calls: calls.filter((call) => call.agent_id === agent.id).length,
    answered: calls.filter((call) => call.agent_id === agent.id && ["answered", "completed"].includes(call.current_state)).length,
  })).sort((left, right) => right.calls - left.calls);

  const stats = [
    { label: "Total contacts", value: contactsPage.blocked || contactsPage.total === null ? "—" : contactsPage.total.toLocaleString(), note: contactsPage.total === null ? "Total not returned by source" : "GHL-reported total", icon: ContactRound, tone: "green" },
    { label: "Open contacts", value: contactsPage.blocked ? "—" : contactCounts.open, note: "Loaded GHL page only", icon: Activity, tone: "lime" },
    { label: "Assigned contacts", value: contactsPage.blocked ? "—" : contactCounts.assigned, note: "Loaded GHL page only", icon: UserRoundCheck, tone: "slate" },
    { label: "Unassigned contacts", value: contactsPage.blocked ? "—" : contactCounts.unassigned, note: "Loaded GHL page only", icon: UserRoundX, tone: "amber" },
    { label: "Calls", value: available ? callsTotal?.toLocaleString() ?? "—" : "—", note: "All saved call records", icon: AudioLines, tone: "green" },
    { label: "Answered", value: available ? callStates.answered?.toLocaleString() ?? "—" : "—", note: "Answer timestamp recorded", icon: ArrowUpRight, tone: "lime" },
    { label: "Failed", value: available ? callStates.failed?.toLocaleString() ?? "—" : "—", note: "Saved failed calls", icon: ArrowDownRight, tone: "amber" },
    { label: "Callbacks due", value: available ? callbacksDueCount?.toLocaleString() ?? "—" : "—", note: `${callbacksOverdueCount ?? overdueCallbacks.length} overdue`, icon: CalendarClock, tone: "slate" },
  ];

  return (
    <WorkspaceShell session={session} section="overview" title="Overview" subtitle="A grounded view of contacts, calls and team activity.">
      {!available ? <div className={styles.dataAlert} role="alert"><strong>Call analytics unavailable</strong><span>Check the database connection and applied migrations. GHL contacts are reported separately.</span></div> : null}
      {contactsPage.blocked ? <div className={styles.dataAlert} role="status"><strong>Contact summary unavailable</strong><span>{contactsPage.blocker}</span></div> : null}

      <div className={styles.rangeRow}><span>Performance window</span><nav aria-label="Performance date range">{[7, 30, 90].map((days) => <Link key={days} href={`/dashboard?range=${days}`} className={rangeDays === days ? styles.rangeActive : styles.rangeLink}>{days} days</Link>)}</nav></div>

      <section className={styles.statGrid} aria-label="CRM summary">
        {stats.map((stat) => { const Icon = stat.icon; return <article className={styles.statCard} key={stat.label}><div className={styles.statTop}><span>{stat.label}</span><i className={styles[stat.tone]}><Icon size={16} strokeWidth={1.8} /></i></div><strong>{stat.value}</strong><small>{stat.note}</small></article>; })}
      </section>

      <div className={styles.analyticsGrid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span className={styles.eyebrow}>CALL ACTIVITY</span><h2>Call volume</h2></div><StatusBadge tone="neutral">Last {rangeDays} days</StatusBadge></header>
          {available && calls.length ? <div className={styles.volumeChart} role="img" aria-label={`Daily saved calls over the last ${rangeDays} days`}>
            {chartDays.map((day) => <div className={styles.chartColumn} key={day.key} title={`${day.label}: ${day.count} calls, ${day.answered} answered, ${day.failed} failed`}><div className={styles.barStack}><span className={styles.barAnswered} style={{ height: `${day.answered / maxDailyCalls * 100}%` }} /><span className={styles.barFailed} style={{ height: `${day.failed / maxDailyCalls * 100}%` }} /></div><small>{day.label}</small></div>)}
            <div className={styles.chartLegend}><span><i className={styles.legendAnswered} />Answered</span><span><i className={styles.legendFailed} />Failed</span></div>
          </div> : <EmptyState title={available ? "No saved calls in this period" : "Call activity unavailable"} detail="Charts appear when real call records exist for the selected dates." icon={<AudioLines size={17} />} />}
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span className={styles.eyebrow}>TEAM</span><h2>Agent performance</h2></div><Link href="/sessions">Activity <ArrowUpRight size={14} /></Link></header>
          {available && agentPerformance.length ? <div className={styles.performanceList}>{agentPerformance.slice(0, 6).map((agent) => <div className={styles.performanceRow} key={agent.id}><div className={styles.agentLabel}><span>{agent.normalized_email}</span><b>{agent.calls} calls</b></div><div className={styles.track}><i style={{ width: `${Math.max(1, agent.calls / Math.max(1, agentPerformance[0].calls) * 100)}%` }} /></div><small>{agent.answered} answered</small></div>)}</div> : <EmptyState title={available ? "No agent call data" : "Agent analytics unavailable"} detail="Agent comparisons use persisted calls only." icon={<UserRoundCheck size={17} />} />}
        </section>
      </div>

      <div className={styles.analyticsGrid}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span className={styles.eyebrow}>CONTACT PIPELINE</span><h2>Status distribution</h2></div><Link href="/contacts">View contacts <ArrowUpRight size={14} /></Link></header>
          {!contactsPage.blocked && contacts.length ? <div className={styles.distribution}><div><StatusBadge tone="success">Open</StatusBadge><b>{contactCounts.open}</b><small>Loaded page</small></div><div><StatusBadge tone="neutral">Other status</StatusBadge><b>{contacts.filter((contact) => contact.status && !contact.isOpen).length}</b><small>Loaded page</small></div><div><StatusBadge tone="warning">Unknown</StatusBadge><b>{contacts.filter((contact) => !contact.status).length}</b><small>Not set in source</small></div></div> : <EmptyState title={contactsPage.blocked ? "Contacts unavailable" : "No contacts returned"} detail="No status chart is fabricated when contact data is missing." icon={<ContactRound size={17} />} />}
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHeader}><div><span className={styles.eyebrow}>RECENT RECORDS</span><h2>Latest calls</h2></div><Link href="/calls">Call history <ArrowUpRight size={14} /></Link></header>
          {available && calls.length ? <div className={styles.recentList}>{calls.slice(0, 6).map((call) => <div className={styles.recentRow} key={call.id}><span className={styles.recentMark}><AudioLines size={14} /></span><div><strong>{call.outcome ?? call.current_state}</strong><small>{call.ghl_contact_id} · {new Date(call.requested_at).toLocaleString()}</small></div><StatusBadge tone={call.current_state === "completed" || call.current_state === "answered" ? "success" : call.current_state === "missed" || call.current_state === "failed" ? "danger" : "neutral"}>{call.current_state}</StatusBadge></div>)}</div> : <EmptyState title={available ? "No calls recorded" : "Call history unavailable"} detail="Only persisted records appear here." icon={<AudioLines size={17} />} />}
        </section>
      </div>

      <section className={styles.panel}>
        <header className={styles.panelHeader}><div><span className={styles.eyebrow}>TEAM STATUS</span><h2>Agent activity</h2></div><span className={styles.panelMeta}>{agents.length} active profiles</span></header>
          {agents.length ? <div className={styles.agentGrid}>{agents.slice(0, 8).map((agent) => { const current = sessions.find((item) => item.agent_id === agent.id); const agentCalls = calls.filter((call) => call.agent_id === agent.id).length; return <Link href={`/agents/${encodeURIComponent(agent.id)}`} className={styles.agentCard} key={agent.id}><div className={styles.agentInitial}>{agent.normalized_email.slice(0, 1).toUpperCase()}</div><div className={styles.agentInfo}><strong>{agent.normalized_email}</strong><small>{agentCalls} calls · {current?.state ?? "No active session"}</small></div><StatusBadge tone={current?.state === "active" ? "success" : "neutral"}>{current?.state ?? "Idle"}</StatusBadge></Link>; })}</div> : <EmptyState title="No active agent profiles" detail="Provision agent profiles to see team activity." icon={<UserRoundCheck size={17} />} />}
        {activity.length ? <div className={styles.activityStrip}><span className={styles.eyebrow}>RECENT ACTIVITY</span>{activity.map((event) => <div key={event.id}><span>{event.event_type.replaceAll("_", " ")}</span><time>{new Date(event.created_at).toLocaleString()}</time></div>)}</div> : null}
      </section>
    </WorkspaceShell>
  );
}