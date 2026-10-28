import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createCompanyCrmClient } from "@/lib/company-database";
import { listCompanyAgentProfiles } from "@/lib/assignable-agents";
import { toCsv, type CsvColumn } from "@/lib/csv-export";

export const dynamic = "force-dynamic";

type ExportRow = Record<string, unknown>;
type ExportContact = { id: string; first_name: string; last_name: string; phone: string | null };

async function readAll<T>(makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await makeQuery(start, start + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function loadContacts(crm: Awaited<ReturnType<typeof createCompanyCrmClient>>["client"], companyId: string, ids: string[]) {
  const contacts = new Map<string, ExportContact>();
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    const { data, error } = await crm.from("contacts")
      .select("id, first_name, last_name, phone")
      .eq("company_id", companyId).in("id", batch);
    if (error) throw new Error("Contact labels could not be loaded.");
    for (const contact of data ?? []) contacts.set(contact.id, contact as ExportContact);
  }
  return contacts;
}

function responseCsv<T extends ExportRow>(type: string, rows: T[], columns: CsvColumn<T>[]) {
  return new Response(toCsv(rows, columns), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) {
    return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  }

  const type = new URL(request.url).searchParams.get("type");
  if (!["contacts", "calls", "callbacks", "agents", "sessions", "session-events"].includes(type ?? "")) {
    return NextResponse.json({ error: "Choose a supported export." }, { status: 400 });
  }

  try {
    const central = await createSupabaseServerClient();
    const { client: crm } = await createCompanyCrmClient(session.companyId);

    if (type === "contacts") {
      const rows = await readAll((from, to) => crm.from("contacts")
        .select("id, first_name, last_name, phone, email, status, subject, notes, lead_source, assigned_agent_id, assigned_agent_ids, custom_fields, created_at, updated_at")
        .eq("company_id", session.companyId!).order("created_at", { ascending: false }).range(from, to));
      const agents = await listCompanyAgentProfiles(session.companyId);
      const agentNames = new Map(agents.map((agent) => [agent.id, agent.email]));
      return responseCsv("contacts", rows, [
        { label: "Contact ID", value: (row) => row.id },
        { label: "First name", value: (row) => row.first_name },
        { label: "Last name", value: (row) => row.last_name },
        { label: "Phone", value: (row) => row.phone },
        { label: "Email", value: (row) => row.email },
        { label: "Status", value: (row) => row.status },
        { label: "Subject", value: (row) => row.subject },
        { label: "Notes", value: (row) => row.notes },
        { label: "Lead source", value: (row) => row.lead_source },
        { label: "Assigned agents", value: (row) => (row.assigned_agent_ids ?? (row.assigned_agent_id ? [row.assigned_agent_id] : [])).map((id: string) => agentNames.get(id) ?? id).join(", ") },
        { label: "Custom fields", value: (row) => row.custom_fields },
        { label: "Created at", value: (row) => row.created_at },
        { label: "Updated at", value: (row) => row.updated_at },
      ]);
    }

    if (type === "calls") {
      const params = new URL(request.url).searchParams;
      const q = params.get("q")?.trim() ?? "";
      const agent = params.get("agent") ?? "all";
      const state = params.get("state") ?? "all";
      const from = params.get("from") ?? "";
      const to = params.get("to") ?? "";
      const calls = await readAll((start, end) => {
        let query = crm.from("calls")
          .select("id, agent_id, ghl_contact_id, internal_contact_id, current_state, requested_at, ringing_at, answered_at, ended_at, verified_duration_seconds, manual_duration_seconds, outcome, call_source, recording_reference")
          .eq("company_id", session.companyId!)
          .order("requested_at", { ascending: false });
        if (q) query = query.ilike("ghl_contact_id", `%${q}%`);
        if (agent !== "all") query = query.eq("agent_id", agent);
        if (state !== "all") query = query.eq("current_state", state);
        if (from && !Number.isNaN(Date.parse(`${from}T00:00:00`))) query = query.gte("requested_at", new Date(`${from}T00:00:00`).toISOString());
        if (to && !Number.isNaN(Date.parse(`${to}T23:59:59.999`))) query = query.lte("requested_at", new Date(`${to}T23:59:59.999`).toISOString());
        return query.range(start, end);
      });
      const ids = [...new Set(calls.flatMap((call) => call.internal_contact_id ? [call.internal_contact_id] : []))];
      const [contacts, companyAgents] = await Promise.all([
        loadContacts(crm, session.companyId, ids),
        listCompanyAgentProfiles(session.companyId),
      ]);
      const agentById = new Map(companyAgents.map((agent) => [agent.id, agent.email]));
      const callIds = calls.map((call) => call.id);
      const dispositionRows = [];
      for (let index = 0; index < callIds.length; index += 100) {
        const callIdBatch = callIds.slice(index, index + 100);
        dispositionRows.push(...await readAll((start, end) => crm.from("call_dispositions")
          .select("call_id, outcome, note, qualified, callback_at, created_at")
          .eq("company_id", session.companyId!).in("call_id", callIdBatch)
          .order("created_at", { ascending: false }).range(start, end)));
      }
      const dispositionsByCall = new Map<string, (typeof dispositionRows)>();
      for (const item of dispositionRows) dispositionsByCall.set(item.call_id, [...(dispositionsByCall.get(item.call_id) ?? []), item]);
      return responseCsv("calls", calls.map((call) => ({
        ...call,
        contact_name: call.internal_contact_id ? [contacts.get(call.internal_contact_id)?.first_name, contacts.get(call.internal_contact_id)?.last_name].filter(Boolean).join(" ") : "",
        phone: call.internal_contact_id ? contacts.get(call.internal_contact_id)?.phone ?? "" : "",
        agent_email: agentById.get(call.agent_id) ?? "",
        dispositions: dispositionsByCall.get(call.id) ?? [],
      })), [
        { label: "Call ID", value: (row) => row.id },
        { label: "Contact ID", value: (row) => row.internal_contact_id ?? row.ghl_contact_id },
        { label: "Contact name", value: (row) => row.contact_name },
        { label: "Phone", value: (row) => row.phone },
        { label: "Agent", value: (row) => row.agent_email },
        { label: "State", value: (row) => row.current_state },
        { label: "Call source", value: (row) => row.call_source },
        { label: "Requested at", value: (row) => row.requested_at },
        { label: "Answered at", value: (row) => row.answered_at },
        { label: "Ended at", value: (row) => row.ended_at },
        { label: "Verified duration seconds", value: (row) => row.verified_duration_seconds },
        { label: "Manual duration seconds", value: (row) => row.manual_duration_seconds },
        { label: "Outcome", value: (row) => row.dispositions.map((item) => item.outcome).filter(Boolean).join(" | ") || row.outcome },
        { label: "Call notes", value: (row) => row.dispositions.map((item) => item.note).filter(Boolean).join(" | ") },
        { label: "Qualified", value: (row) => row.dispositions.map((item) => item.qualified).join(" | ") },
        { label: "Callback at", value: (row) => row.dispositions.map((item) => item.callback_at).filter(Boolean).join(" | ") },
        { label: "Disposition dates", value: (row) => row.dispositions.map((item) => item.created_at).join(" | ") },
        { label: "Recording reference", value: (row) => row.recording_reference },
      ]);
    }

    if (type === "callbacks") {
      const rows = await readAll((from, to) => crm.from("callbacks")
        .select("id, contact_id, internal_contact_id, agent_id, due_at, timezone, status, source_call_id, completed_at, created_at")
        .eq("company_id", session.companyId!).order("due_at", { ascending: true }).range(from, to));
      const ids = [...new Set(rows.flatMap((row) => row.internal_contact_id ? [row.internal_contact_id] : []))];
      const sourceCallIds = [...new Set(rows.flatMap((row) => row.source_call_id ? [row.source_call_id] : []))];
      const [contacts, companyAgents] = await Promise.all([
        loadContacts(crm, session.companyId, ids),
        listCompanyAgentProfiles(session.companyId),
      ]);
      const agentById = new Map(companyAgents.map((agent) => [agent.id, agent.email]));
      const sourceDispositionRows = [];
      for (let index = 0; index < sourceCallIds.length; index += 100) {
        const callIdBatch = sourceCallIds.slice(index, index + 100);
        sourceDispositionRows.push(...await readAll((start, end) => crm.from("call_dispositions")
          .select("call_id, note, created_at")
          .eq("company_id", session.companyId!).in("call_id", callIdBatch)
          .order("created_at", { ascending: false }).range(start, end)));
      }
      const sourceNotes = new Map<string, string>();
      for (const item of sourceDispositionRows) {
        if (item.note && !sourceNotes.has(item.call_id)) sourceNotes.set(item.call_id, item.note);
      }
      return responseCsv("callbacks", rows.map((row) => ({
        ...row,
        contact_name: row.internal_contact_id ? [contacts.get(row.internal_contact_id)?.first_name, contacts.get(row.internal_contact_id)?.last_name].filter(Boolean).join(" ") : "",
        phone: row.internal_contact_id ? contacts.get(row.internal_contact_id)?.phone ?? "" : "",
        agent_email: agentById.get(row.agent_id) ?? "",
        notes: row.source_call_id ? sourceNotes.get(row.source_call_id) ?? "" : "",
      })), [
        { label: "Callback ID", value: (row) => row.id },
        { label: "Contact ID", value: (row) => row.internal_contact_id ?? row.contact_id },
        { label: "Contact name", value: (row) => row.contact_name },
        { label: "Phone", value: (row) => row.phone },
        { label: "Agent", value: (row) => row.agent_email },
        { label: "Due at", value: (row) => row.due_at },
        { label: "Timezone", value: (row) => row.timezone },
        { label: "Status", value: (row) => row.status },
        { label: "Call notes", value: (row) => row.notes },
        { label: "Source call ID", value: (row) => row.source_call_id },
        { label: "Completed at", value: (row) => row.completed_at },
        { label: "Created at", value: (row) => row.created_at },
      ]);
    }

    if (type === "agents") {
      const agents = await listCompanyAgentProfiles(session.companyId);
      const ids = agents.map((agent) => agent.id);
      const [contacts, calls, callbacks, sessions] = ids.length ? await Promise.all([
        readAll((from, to) => crm.from("contacts").select("assigned_agent_id, assigned_agent_ids").eq("company_id", session.companyId!).eq("status", "open").range(from, to)),
        readAll((from, to) => crm.from("calls").select("agent_id").eq("company_id", session.companyId!).in("agent_id", ids).range(from, to)),
        readAll((from, to) => crm.from("callbacks").select("agent_id").eq("company_id", session.companyId!).in("status", ["scheduled", "due", "missed"]).in("agent_id", ids).range(from, to)),
        readAll((from, to) => central.from("work_sessions").select("agent_id").eq("company_id", session.companyId!).in("agent_id", ids).in("state", ["active", "paused"]).range(from, to)),
      ]) : [[], [], [], []];
      const countFor = (rows: Array<{ assigned_agent_id?: string | null; assigned_agent_ids?: string[]; agent_id?: string }>, id: string) =>
        rows.filter((row) => row.agent_id === id || (row.assigned_agent_ids ?? (row.assigned_agent_id ? [row.assigned_agent_id] : [])).includes(id)).length;
      return responseCsv("agents", agents.map((agent) => ({
        name: agent.name,
        email: agent.email,
        active: agent.isActive,
        open_contacts: countFor(contacts, agent.id),
        calls: countFor(calls, agent.id),
        callbacks: countFor(callbacks, agent.id),
        has_active_session: sessions.some((row) => row.agent_id === agent.id),
      })), [
        { label: "Name", value: (row) => row.name },
        { label: "Email", value: (row) => row.email },
        { label: "Active", value: (row) => row.active },
        { label: "Open contacts", value: (row) => row.open_contacts },
        { label: "Calls", value: (row) => row.calls },
        { label: "Callbacks", value: (row) => row.callbacks },
        { label: "Active session", value: (row) => row.has_active_session },
      ]);
    }

    if (type === "session-events") {
      const rows = await readAll((from, to) => central.from("work_session_events")
        .select("id, session_id, agent_id, event_type, reason, occurred_at")
        .eq("company_id", session.companyId!)
        .order("occurred_at", { ascending: false })
        .range(from, to));
      const companyAgents = await listCompanyAgentProfiles(session.companyId);
      const agents = new Map(companyAgents.map((agent) => [agent.id, agent.email]));
      return responseCsv("session-events", rows.map((row) => ({
        ...row,
        agent_email: agents.get(row.agent_id) ?? "",
      })), [
        { label: "Event ID", value: (row) => row.id },
        { label: "Session ID", value: (row) => row.session_id },
        { label: "Agent", value: (row) => row.agent_email },
        { label: "Event", value: (row) => row.event_type },
        { label: "Occurred at", value: (row) => row.occurred_at },
        { label: "Reason", value: (row) => row.reason },
      ]);
    }

    const rows = await readAll((from, to) => central.from("work_sessions")
      .select("id, agent_id, started_at, ended_at, state, idle_seconds, active_seconds, reason")
      .eq("company_id", session.companyId!).order("started_at", { ascending: false }).range(from, to));
    const companyAgents = await listCompanyAgentProfiles(session.companyId);
    const agents = new Map(companyAgents.map((agent) => [agent.id, agent.email]));
    return responseCsv("sessions", rows.map((row) => ({ ...row, agent_email: agents.get(row.agent_id) ?? "" })), [
      { label: "Session ID", value: (row) => row.id },
      { label: "Agent", value: (row) => row.agent_email },
      { label: "Started at", value: (row) => row.started_at },
      { label: "Ended at", value: (row) => row.ended_at },
      { label: "State", value: (row) => row.state },
      { label: "Idle seconds", value: (row) => row.idle_seconds },
      { label: "Active seconds", value: (row) => row.active_seconds },
      { label: "Reason", value: (row) => row.reason },
    ]);
  } catch {
    return NextResponse.json({ error: "The export could not be generated. Check company database connectivity and permissions." }, { status: 503 });
  }
}
