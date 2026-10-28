import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import CallbackList, { type CallbackCardData } from "@/app/callbacks/callback-list";
import { getCompanyContact } from "@/lib/contacts";
import { getSession } from "@/lib/session";
import styles from "@/app/callbacks/callback-list.module.css";
import { createCompanyCrmClient } from "@/lib/company-database";
import { AdminExportLink } from "@/components/admin-export-link";
import { getAgentContactFields } from "@/lib/agent-contact-fields";

export const dynamic = "force-dynamic";

type CallbackRow = { id: string; contact_id: string; internal_contact_id: string | null; agent_id: string; due_at: string; timezone: string; status: string; source_call_id: string | null };

function callbackDueLabel(dueAt: string): CallbackCardData["dueLabel"] {
  const due = new Date(dueAt);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  if (due.getTime() < now.getTime() && dueDay.getTime() < today.getTime()) return "Overdue";
  if (dueDay.getTime() === today.getTime()) return "Due today";
  return "Upcoming";
}

export default async function CallbackQueuePage({ searchParams }: { searchParams?: Promise<{ page?: string; size?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = searchParams ? await searchParams : {};
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = [10, 25, 50, 100].includes(Number(params.size)) ? Number(params.size) : 25;

  let callbackData: CallbackCardData[] = [];
  let unavailable = false;
  let total = 0;
  try {
    if (!session.companyId) throw new Error("Company access is required.");
    const agentFields = session.role === "agent" ? new Set(await getAgentContactFields(session.companyId, session.id)) : new Set<string>();
    const { client: supabase } = await createCompanyCrmClient(session.companyId);
    const { data, error, count } = await supabase
      .from("callbacks")
      .select("id, contact_id, internal_contact_id, agent_id, due_at, timezone, status, source_call_id", { count: "exact" })
      .eq("company_id", session.companyId)
      .in("status", ["scheduled", "due", "missed"])
      .order("due_at", { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) unavailable = true;
    else {
      const rows = (data ?? []) as CallbackRow[];
      total = count ?? 0;
      const sourceCallIds = [...new Set(rows.flatMap((row) => row.source_call_id ? [row.source_call_id] : []))];
      const [contacts, dispositions] = await Promise.all([
        Promise.all(rows.map((row) => row.internal_contact_id && session.companyId
          ? getCompanyContact(row.internal_contact_id, session.companyId)
          : Promise.resolve(null))),
        sourceCallIds.length ? supabase.from("call_dispositions").select("call_id, note").in("call_id", sourceCallIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (dispositions.error) unavailable = true;
      const notes = new Map((dispositions.data ?? []).map((item) => [item.call_id, item.note]));
      callbackData = rows.map((row, index) => {
        const contact = contacts[index];
        const contactDetails = contact && session.role === "agent"
          ? [...agentFields].flatMap((field) => {
            if (field === "name" || field === "phone" || field === "status") return [];
            const standard = {
              email: contact.email,
              subject: contact.subject,
              notes: contact.notes,
              lead_source: contact.leadSource,
            }[field as "email" | "subject" | "notes" | "lead_source"];
            const custom = field.startsWith("custom:") ? contact.customFields[field.slice(7)] : undefined;
            const value = standard ?? custom;
            return typeof value === "string" && value.trim() ? [value.trim()] : [];
          })
          : [];
        return {
          id: row.id,
          contactId: session.role === "admin" ? row.internal_contact_id ?? "" : "",
          callContactId: session.role === "agent" ? row.internal_contact_id ?? undefined : undefined,
          name: contact?.name && (session.role === "admin" || agentFields.has("name")) ? contact.name : session.role === "admin" ? `Contact ${row.contact_id}` : "Contact",
          contactDetails,
          phone: contact ? session.role === "admin" ? contact.phone : agentFields.has("phone") ? contact.maskedPhone : null : null,
          isAgent: session.role === "agent",
          dueAt: row.due_at,
          timezone: row.timezone,
          status: row.status,
          notes: row.source_call_id ? notes.get(row.source_call_id) ?? null : null,
          dueLabel: callbackDueLabel(row.due_at),
        };
      });
    }
  } catch {
    unavailable = true;
  }

  const overdue = callbackData.filter((item) => item.dueLabel === "Overdue").length;
  const dueToday = callbackData.filter((item) => item.dueLabel === "Due today").length;

  return (
    <WorkspaceShell session={session} section="callbacks" title={session.role === "admin" ? "Callbacks" : "My callbacks"} subtitle={session.role === "admin" ? "Monitor scheduled follow-ups across the team." : "Follow-ups assigned to you, ordered by due time."}>
      {unavailable ? <div className={styles.warning} role="alert">Callback data is unavailable. Check the database connection and permissions.</div> : null}
      <section className={styles.summary}>
        <div><span>ACTIVE FOLLOW-UPS</span><strong>{unavailable ? "—" : callbackData.length}</strong></div>
        <div><span>DUE TODAY</span><strong>{unavailable ? "—" : dueToday}</strong></div>
        <div><span>OVERDUE</span><strong>{unavailable ? "—" : overdue}</strong></div>
        <div className={styles.sourceNote}><CalendarClock size={16} /><span>Saved callbacks only</span></div>
      </section>
      {session.role === "admin" ? <AdminExportLink type="callbacks" /> : null}
      {callbackData.length ? <CallbackList callbacks={callbackData} page={page} pageSize={pageSize} total={total} /> : unavailable ? null : <EmptyState title="No callbacks to work" detail="Saved follow-ups will appear here when scheduled." icon={<CalendarClock size={18} />} />}
    </WorkspaceShell>
  );
}