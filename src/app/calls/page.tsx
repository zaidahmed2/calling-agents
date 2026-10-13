import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, AudioLines, Search } from "lucide-react";

import { WorkspaceShell } from "@/components/workspace-shell";
import { EmptyState, StatusBadge } from "@/components/ui";
import { getGhlContact } from "@/lib/ghl";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/calls/calls.module.css";

export const dynamic = "force-dynamic";

type CallRow = { id: string; agent_id: string; ghl_contact_id: string; current_state: string; requested_at: string; answered_at: string | null; ended_at: string | null; verified_duration_seconds: number | null; outcome: string | null };
type AgentRow = { id: string; normalized_email: string };
type DispositionRow = { call_id: string; outcome: string; note: string | null; qualified: boolean; callback_at: string | null; created_at: string };

function stateTone(state: string): "success" | "warning" | "danger" | "neutral" {
  if (state === "answered" || state === "completed") return "success";
  if (state === "missed") return "warning";
  if (state === "failed" || state === "cancelled") return "danger";
  return "neutral";
}

export default async function CallHistoryPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");
  const params = searchParams ? await searchParams : {};
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(params.size)) ? Number(params.size) : 25;
  const q = params.q?.trim() ?? "";
  const selectedAgent = params.agent ?? "all";
  const selectedState = params.state ?? "all";
  const from = params.from ?? "";
  const to = params.to ?? "";

  let calls: CallRow[] = [];
  let agents: AgentRow[] = [];
  let dispositions: DispositionRow[] = [];
  let contacts = new Map<string, Awaited<ReturnType<typeof getGhlContact>>>();
  let total = 0;
  let unavailable = false;

  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase.from("calls").select("id, agent_id, ghl_contact_id, current_state, requested_at, answered_at, ended_at, verified_duration_seconds, outcome", { count: "exact" }).order("requested_at", { ascending: false });
    if (q) query = query.ilike("ghl_contact_id", `%${q}%`);
    if (selectedAgent !== "all") query = query.eq("agent_id", selectedAgent);
    if (selectedState !== "all") query = query.eq("current_state", selectedState);
    if (from) query = query.gte("requested_at", new Date(`${from}T00:00:00`).toISOString());
    if (to) query = query.lte("requested_at", new Date(`${to}T23:59:59.999`).toISOString());
    const [callResult, agentResult] = await Promise.all([
      query.range((page - 1) * pageSize, page * pageSize - 1),
      supabase.from("profiles").select("id, normalized_email").eq("app_role", "agent").eq("is_active", true).order("normalized_email"),
    ]);
    if (callResult.error || agentResult.error) unavailable = true;
    else {
      calls = callResult.data ?? [];
      total = callResult.count ?? 0;
      agents = agentResult.data ?? [];
      const ids = [...new Set(calls.map((call) => call.ghl_contact_id))];
      const callIds = calls.map((call) => call.id);
      const [contactResults, dispositionResult] = await Promise.all([
        Promise.all(ids.map((id) => getGhlContact(id))),
        callIds.length ? supabase.from("call_dispositions").select("call_id, outcome, note, qualified, callback_at, created_at").in("call_id", callIds).order("created_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
      ]);
      contacts = new Map(ids.map((id, index) => [id, contactResults[index]]));
      if (dispositionResult.error) unavailable = true;
      else dispositions = (dispositionResult.data ?? []) as DispositionRow[];
    }
  } catch {
    unavailable = true;
  }

  const agentNames = new Map(agents.map((agent) => [agent.id, agent.normalized_email]));
  const latestDisposition = new Map<string, DispositionRow>();
  for (const item of dispositions) if (!latestDisposition.has(item.call_id)) latestDisposition.set(item.call_id, item);
  const queryFor = (nextPage: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (selectedAgent !== "all") query.set("agent", selectedAgent);
    if (selectedState !== "all") query.set("state", selectedState);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    query.set("size", String(pageSize));
    query.set("page", String(nextPage));
    return `/calls?${query.toString()}`;
  };
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return <WorkspaceShell session={session} section="calls" title="Call history" subtitle="All persisted calls across agents, with source contact details where available.">
    <section className={styles.panel}>
      <form className={styles.filters} action="/calls" method="get">
        <label className={styles.search}><Search size={14} /><input type="search" name="q" defaultValue={q} placeholder="Search contact reference" aria-label="Search contact reference" /></label>
        <label>Agent<select name="agent" defaultValue={selectedAgent}><option value="all">All agents</option>{agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.normalized_email}</option>)}</select></label>
        <label>Outcome<select name="state" defaultValue={selectedState}><option value="all">All states</option>{["requested", "ringing", "answered", "completed", "failed", "cancelled"].map((state) => <option key={state}>{state}</option>)}</select></label>
        <label>From<input type="date" name="from" defaultValue={from} /></label>
        <label>To<input type="date" name="to" defaultValue={to} /></label>
        <label>Rows<select name="size" defaultValue={pageSize}><option>10</option><option>25</option><option>50</option><option>100</option></select></label>
        <button type="submit">Apply</button>
      </form>
      {unavailable ? <div className={styles.error} role="alert">Call history could not be loaded. Check database connectivity and permissions.</div> : null}
      <div className={styles.tableScroll}><table><thead><tr><th>CONTACT</th><th>PHONE</th><th>AGENT</th><th>DATE & TIME</th><th>DURATION</th><th>OUTCOME</th><th>STATE</th><th>DETAILS</th></tr></thead><tbody>
        {calls.map((call) => {
          const contact = contacts.get(call.ghl_contact_id);
          const disposition = latestDisposition.get(call.id);
          return <tr key={call.id}><td><Link href={`/contacts/${encodeURIComponent(call.ghl_contact_id)}`} className={styles.contactName}>{contact?.name ?? `Contact ${call.ghl_contact_id}`}<small>{call.ghl_contact_id}</small></Link>{disposition?.note ? <details className={styles.note}><summary>View note</summary><p>{disposition.note}</p></details> : null}</td><td>{contact?.phone ?? "Unavailable"}</td><td>{agentNames.get(call.agent_id) ?? "Unknown agent"}</td><td>{new Date(call.requested_at).toLocaleString()}</td><td>{call.verified_duration_seconds === null ? "—" : `${Math.floor(call.verified_duration_seconds / 60)}m ${String(call.verified_duration_seconds % 60).padStart(2, "0")}s`}</td><td>{disposition?.outcome ?? call.outcome ?? "—"}{disposition?.callback_at ? <small className={styles.subLine}>Callback {new Date(disposition.callback_at).toLocaleString()}</small> : null}</td><td><StatusBadge tone={stateTone(call.current_state)}>{call.current_state}</StatusBadge></td><td><Link href={`/calls/${encodeURIComponent(call.id)}`} className={styles.detailLink} aria-label={`View details for call ${call.id}`}><ArrowUpRight size={14} /></Link></td></tr>;
        })}
      </tbody></table>
      {!unavailable && calls.length === 0 ? <EmptyState title="No calls found" detail="Saved call history matching these filters will appear here." icon={<AudioLines size={18} />} /> : null}</div>
      <div className={styles.paginationLinks}><Link href={queryFor(Math.max(1, page - 1))} aria-disabled={page <= 1}>Previous</Link><span>Page {page} of {pageCount} · {total} records</span><Link href={queryFor(Math.min(pageCount, page + 1))} aria-disabled={page >= pageCount}>Next</Link></div>
    </section>
  </WorkspaceShell>;
}