export type WorkSessionState = "active" | "paused" | "ended";

export type WorkSession = {
  sessionId: string;
  agentId: string;
  startedAt: string;
  updatedAt: string;
  state: WorkSessionState;
  idleSeconds: number;
  hasActiveCall: boolean;
  reason?: string;
};

export const IDLE_THRESHOLD_SECONDS = 60;

export function createWorkSession(agentId: string): WorkSession {
  const now = new Date().toISOString();

  return {
    sessionId: `session-${Date.now()}-${agentId}`,
    agentId,
    startedAt: now,
    updatedAt: now,
    state: "active",
    idleSeconds: 0,
    hasActiveCall: false,
  };
}

export function evaluateIdleState(session: WorkSession, now: Date): WorkSession {
  if (session.state === "ended") {
    return session;
  }

  const idleSeconds = Math.max(0, Math.round((now.getTime() - new Date(session.updatedAt).getTime()) / 1000));
  const nextIdle = session.idleSeconds + idleSeconds;

  if (session.hasActiveCall) {
    return {
      ...session,
      updatedAt: now.toISOString(),
      idleSeconds: 0,
      reason: "Active call exempts the session from idle timeout.",
    };
  }

  if (nextIdle >= IDLE_THRESHOLD_SECONDS) {
    return {
      ...session,
      updatedAt: now.toISOString(),
      state: "paused",
      idleSeconds: nextIdle,
      reason: "No qualifying activity detected for 60 seconds.",
    };
  }

  return {
    ...session,
    updatedAt: now.toISOString(),
    idleSeconds: nextIdle,
    reason: "Session remains active while activity is still qualifying.",
  };
}

export function endWorkSession(session: WorkSession, reason: string): WorkSession {
  return {
    ...session,
    state: "ended",
    updatedAt: new Date().toISOString(),
    reason,
  };
}
