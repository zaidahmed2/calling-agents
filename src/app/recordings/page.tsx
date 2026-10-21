import Link from "next/link";
import { redirect } from "next/navigation";
import { AudioLines } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { WorkspaceShell } from "@/components/workspace-shell";
import RecordingsList from "@/app/recordings/recordings-list";
import { createCompanyCrmClient } from "@/lib/company-database";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import styles from "@/app/calls/calls.module.css";

export const dynamic = "force-dynamic";

type CallRow = {
  id: string;
  agent_id: string;
  internal_contact_id: string | null;
  requested_at: string;
  answered_at: string;
  verified_duration_seconds: number | null;
  manual_duration_seconds: number | null;
};

type ContactRow = { id: string; first_name: string; last_name: string; phone: string | null };
type AgentRow = { id: string; normalized_email: string };

export default async function RecordingsPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "super_admin" && !session.companyId) redirect("/super-admin");
  if (!session.companyId || !["admin", "agent"].includes(session.role)) redirect("/open-queue");

  const params = searchParams ? await searchParams : {};
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 25;
  let calls: CallRow[] = [];
  let contacts = new Map<string, ContactRow>();
  let agentNames = new Map<string, string>();
  let total = 0;
  let loadError = "";

  try {
    const { client: crm } = await createCompanyCrmClient(session.companyId);
    let query = crm.from("calls")
      .select("id, agent_id, internal_contact_id, requested_at, answered_at, verified_duration_seconds, manual_duration_seconds", { count: "exact" })
      .eq("company_id", session.companyId)
      .not("answered_at", "is", null)
      .not("provider_call_id", "is", null)
      .order("answered_at", { ascending: false });
    if (session.role === "agent") query = query.eq("agent_id", session.id);

    const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    calls = (data ?? []) as CallRow[];
    total = count ?? 0;

    const contactIds = [...new Set(calls.flatMap((call) => call.internal_contact_id ? [call.internal_contact_id] : []))];
    if (contactIds.length) {
      const { data: contactRows, error: contactError } = await crm.from("contacts")
        .select("id, first_name, last_name, phone")
        .eq("company_id", session.companyId)
        .in("id", contactIds);
      if (contactError) throw new Error(contactError.message);
      contacts = new Map(((contactRows ?? []) as ContactRow[]).map((contact) => [contact.id, contact]));
    }

    if (session.role === "admin" && calls.length) {
      const agentIds = [...new Set(calls.map((call) => call.agent_id))];
      const supabase = await createSupabaseServerClient();
      const { data: agents, error: agentError } = await supabase.from("profiles").select("id, normalized_email").in("id", agentIds);
      if (agentError) throw new Error(agentError.message);
      agentNames = new Map(((agents ?? []) as AgentRow[]).map((agent) => [agent.id, agent.normalized_email]));
    }
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Answered calls could not be loaded.";
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (nextPage: number) => `/recordings?page=${nextPage}`;

  return <WorkspaceShell
    session={session}
    section="recordings"
    title="Call recordings"
    subtitle={session.role === "admin" ? "Listen to available recordings from answered company calls." : "Listen to available recordings from your answered calls."}
  >
    <section className={styles.panel}>
      {loadError ? <div className={styles.error} role="alert">Call recordings could not be loaded. {loadError}</div> : null}
      {!loadError && calls.length ? <RecordingsList
        calls={calls.map((call) => {
          const contact = call.internal_contact_id ? contacts.get(call.internal_contact_id) : undefined;
          return {
            ...call,
            contactName: contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unnamed contact" : "Contact unavailable",
            phone: contact?.phone ?? null,
            agentName: agentNames.get(call.agent_id) ?? (session.role === "agent" ? session.displayName : "Unknown agent"),
          };
        })}
        admin={session.role === "admin"}
      /> : null}
      {!loadError && calls.length === 0 ? <EmptyState title="No answered calls yet" detail="Recordings will appear here when an answered call has been recorded by Crazytel." icon={<AudioLines size={18} />} /> : null}
      {!loadError && calls.length > 0 ? <div className={styles.paginationLinks}>
        <Link href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1}>Previous</Link>
        <span>Page {page} of {pageCount} · {total} answered calls</span>
        <Link href={pageHref(Math.min(pageCount, page + 1))} aria-disabled={page >= pageCount}>Next</Link>
      </div> : null}
    </section>
  </WorkspaceShell>;
}
