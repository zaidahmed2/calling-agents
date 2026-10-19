import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/sessions/page.module.css";
import { AdminExportLink } from "@/components/admin-export-link";

export const dynamic = "force-dynamic";

type WorkSessionRow = {
  id: string;
  agent_id: string;
  started_at: string;
  ended_at: string | null;
  state: string;
  idle_seconds: number;
  active_seconds: number;
  reason: string | null;
};

export default async function WorkSessionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let sessions: WorkSessionRow[] = [];
  let unavailable = false;
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase
      .from("work_sessions")
      .select("id, agent_id, started_at, ended_at, state, idle_seconds, active_seconds, reason")
      .order("started_at", { ascending: false })
      .limit(100);
    if (session.role !== "admin") query = query.eq("agent_id", session.id);
    const { data, error } = await query;
    if (error) unavailable = true;
    else sessions = (data ?? []) as WorkSessionRow[];
  } catch {
    unavailable = true;
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.header}>
          <div><p className={styles.eyebrow}>Work sessions</p><h1 className={styles.title}>Session history</h1></div>
          <div className={styles.headerActions}>{session.role === "admin" ? <AdminExportLink type="sessions" /> : null}<span className={`${styles.statusPill} ${styles.active}`}>{session.role}</span></div>
        </div>

        {unavailable ? <div className={styles.notice} role="alert"><strong>Session data unavailable</strong><p>Check the Supabase connection and applied migrations.</p></div> : null}

        <div className={styles.grid}>
          <article className={styles.card}>
            <h2>Recorded sessions</h2>
            <p>{unavailable ? "Unavailable" : sessions.length}</p>
            <p className={styles.muted}>Session records are read from the database. This page does not simulate work time.</p>
          </article>
          <article className={styles.card}>
            <h2>Idle policy</h2>
            <p>60-second threshold configured</p>
            <p className={styles.muted}>Active sessions pause after 60 seconds without recorded activity. Verified active calls are exempt.</p>
          </article>
        </div>

        <div className={styles.sessionList}>
          {sessions.map((item) => (
            <article className={styles.card} key={item.id}>
              <h2>{item.state}</h2>
              <ul>
                <li>Started: {new Date(item.started_at).toLocaleString()}</li>
                <li>Ended: {item.ended_at ? new Date(item.ended_at).toLocaleString() : "Still open"}</li>
                <li>Recorded idle seconds: {item.idle_seconds}</li>
                <li>Recorded active time: {Math.floor(item.active_seconds / 60)}m {String(item.active_seconds % 60).padStart(2, "0")}s</li>
                {session.role === "admin" ? <li>Agent ID: {item.agent_id}</li> : null}
              </ul>
              {item.reason ? <p className={styles.muted}>{item.reason}</p> : null}
            </article>
          ))}
          {!unavailable && sessions.length === 0 ? <div className={styles.notice}>No work-session records yet.</div> : null}
        </div>
      </section>
    </main>
  );
}