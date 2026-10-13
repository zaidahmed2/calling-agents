"use client";

import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { CirclePause, CirclePlay, CircleStop, Clock3 } from "lucide-react";

import { Button, ConfirmDialog, StatusBadge } from "@/components/ui";
import styles from "@/app/open-queue/work-session-timer.module.css";

type SessionData = {
  id: string;
  state: "active" | "paused" | "ended";
  started_at: string;
  ended_at: string | null;
  state_changed_at: string | null;
  active_seconds: number;
  idle_seconds: number;
  reason: string | null;
};

type ApiResult = { session: SessionData | null; history?: SessionData[]; error?: string };

const formatTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor(seconds % 3600 / 60).toString().padStart(2, "0");
  const remaining = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remaining}`;
};

export default function WorkSessionTimer() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [history, setHistory] = useState<SessionData[]>([]);
  const [now, setNow] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [idleCheckFailed, setIdleCheckFailed] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const checkIdle = useEffectEvent(async () => {
    if (!session || session.state !== "active") return;
    try {
      const response = await fetch("/api/work-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_idle" }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok) throw new Error(result.error ?? "Idle protection is unavailable.");
      setSession(result.session);
      setError("");
      setIdleCheckFailed(false);
    } catch (checkError) {
      setIdleCheckFailed(true);
      setError(checkError instanceof Error ? checkError.message : "Idle protection could not check this session. Pause manually when away.");
    }
  });

  const pauseOnLeave = useEffectEvent(() => {
    if (!session || session.state !== "active") return;
    void fetch("/api/work-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
      keepalive: true,
    });
  });

  useEffect(() => {
    let mounted = true;
    fetch("/api/work-sessions", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ApiResult;
        if (!response.ok) throw new Error(result.error ?? "Timer status is unavailable.");
        return result;
      })
      .then((result) => {
        if (!mounted) return;
        setSession(result.session);
        setHistory(result.history ?? []);
        setError("");
      })
      .catch((loadError: unknown) => {
        if (mounted) setError(loadError instanceof Error ? loadError.message : "Timer status is unavailable.");
      })
      .finally(() => { if (mounted) setLoading(false); });
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { mounted = false; window.clearInterval(ticker); };
  }, []);

  const sessionIsActive = session?.state === "active";
  useEffect(() => {
    if (!sessionIsActive) return;
    const initialCheck = idleCheckFailed ? null : window.setTimeout(() => void checkIdle(), 0);
    const idleCheck = window.setInterval(() => void checkIdle(), idleCheckFailed ? 60_000 : 15_000);
    window.addEventListener("pagehide", pauseOnLeave);
    return () => {
      if (initialCheck !== null) window.clearTimeout(initialCheck);
      window.clearInterval(idleCheck);
      window.removeEventListener("pagehide", pauseOnLeave);
    };
  }, [sessionIsActive, idleCheckFailed]);

  async function act(action: "start" | "pause" | "resume" | "end") {
    setError("");
    startTransition(async () => {
      try {
        const response = await fetch("/api/work-sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const result = await response.json() as ApiResult;
        if (!response.ok) throw new Error(result.error ?? "Timer action could not be completed.");
        setSession(result.session);
        if (action === "end") {
          const refreshed = await fetch("/api/work-sessions", { cache: "no-store" });
          const historyResult = await refreshed.json() as ApiResult;
          if (refreshed.ok) setHistory(historyResult.history ?? []);
        }
        setConfirmEnd(false);
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : "Timer action could not be completed.");
      }
    });
  }

  const elapsed = session
    ? session.active_seconds + (session.state === "active" ? Math.max(0, Math.floor((now - new Date(session.state_changed_at ?? session.started_at).getTime()) / 1000)) : 0)
    : 0;

  return <section className={styles.timer} aria-label="Work session timer">
    <div className={styles.timerIdentity}><span className={styles.timerIcon}><Clock3 size={17} /></span><div><strong>Work session</strong><small>{session ? `Started ${new Date(session.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Track your active work time"}</small></div></div>
    <div className={styles.timerReadout} aria-live="off">{loading ? "--:--:--" : formatTime(elapsed)}</div>
    {session ? <StatusBadge tone={session.state === "active" ? "success" : "warning"}>{session.state === "active" ? "Running" : "Paused"}</StatusBadge> : <StatusBadge tone="neutral">Not started</StatusBadge>}
    <div className={styles.timerActions}>
      {!session ? <Button disabled={loading || working} onClick={() => void act("start")}><CirclePlay size={15} /> Start</Button> : null}
      {session?.state === "active" ? <Button variant="secondary" disabled={working} onClick={() => void act("pause")}><CirclePause size={15} /> Pause</Button> : null}
      {session?.state === "paused" ? <Button disabled={working} onClick={() => void act("resume")}><CirclePlay size={15} /> Resume</Button> : null}
      {session ? <Button variant="quiet" disabled={working} onClick={() => setConfirmEnd(true)}><CircleStop size={15} /> End</Button> : null}
    </div>
    <p className={styles.timerPolicy}>{session?.state === "paused" && session.reason?.includes("60 seconds") ? "Paused after 60 seconds without recorded activity." : "Pauses after 60 seconds without recorded activity. Active calls are exempt."}</p>
    {error ? <p className={styles.timerError} role="alert">{error}</p> : null}
    {history.length ? <div className={styles.sessionHistory}><strong>Recent sessions</strong>{history.map((item) => <div className={styles.sessionHistoryRow} key={item.id}><span>{new Date(item.started_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{item.ended_at ? ` – ${new Date(item.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}</span><span>{formatTime(item.active_seconds)}</span><span>{item.idle_seconds ? `${Math.floor(item.idle_seconds / 60)}m idle` : "No idle time"}</span></div>)}</div> : null}
    <ConfirmDialog open={confirmEnd} title="End this work session?" detail="The session will stop and its active time will be saved." confirmLabel="End session" pending={working} onCancel={() => setConfirmEnd(false)} onConfirm={() => void act("end")} />
  </section>;
}