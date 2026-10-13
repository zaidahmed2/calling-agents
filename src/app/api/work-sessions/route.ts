import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const sessionFields = "id, state, started_at, ended_at, state_changed_at, active_seconds, idle_seconds, reason";

function timerRpcErrorMessage(code: string | undefined): string {
  if (code === "PGRST202" || code === "PGRST204") {
    return "The database API has not loaded the timer function yet. Run `npx supabase db push` against the same project this app uses, then reload.";
  }
  if (code === "42703" || code === "42702") {
    return "The timer database function still has the old column-ambiguity bug. Apply migration 20261010_000006_qualify_work_session_columns.sql to this Supabase project, then reload.";
  }
  if (code === "42501") {
    return "The database denied this timer action. Check the timer function permissions for signed-in users.";
  }
  if (code === "P0001") {
    return "The timer action was rejected because the session state changed. Reload the page and try again.";
  }
  return `The database rejected this timer action (code ${code ?? "unknown"}). Check the development server log for the RPC error.`;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "agent") return NextResponse.json({ error: "Agent access is required." }, { status: 403 });

  try {
    const supabase = await createSupabaseServerClient();
    const [activeResult, historyResult] = await Promise.all([
      supabase.from("work_sessions").select(sessionFields).eq("agent_id", session.id).in("state", ["active", "paused"]).order("started_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("work_sessions").select(sessionFields).eq("agent_id", session.id).eq("state", "ended").order("ended_at", { ascending: false }).limit(10),
    ]);
    if (activeResult.error || historyResult.error) return NextResponse.json({ error: "Timer status is unavailable. Apply the latest workspace migration." }, { status: 503 });
    return NextResponse.json({ session: activeResult.data, history: historyResult.data ?? [] });
  } catch {
    return NextResponse.json({ error: "Timer status is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "agent") return NextResponse.json({ error: "Agent access is required." }, { status: 403 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid timer action." }, { status: 400 }); }
  const action = payload && typeof payload === "object" ? (payload as Record<string, unknown>).action : null;
  if (typeof action !== "string" || !["start", "pause", "resume", "end", "check_idle", "activity"].includes(action)) {
    return NextResponse.json({ error: "Unsupported timer action." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("work_session_action", { p_action: action });
    if (error) {
      console.error("work_session_action RPC failed", { code: error.code, message: error.message });
      return NextResponse.json({ error: timerRpcErrorMessage(error.code), code: error.code }, { status: 503 });
    }
    const returnedState = data && typeof data === "object" ? (data as Record<string, unknown>).state : null;
    return NextResponse.json({ session: returnedState === "ended" || returnedState === "none" ? null : data });
  } catch {
    return NextResponse.json({ error: "Timer action could not be completed." }, { status: 503 });
  }
}