import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace-shell";
import { listContactsForAgent } from "@/lib/contacts";
import { getSession } from "@/lib/session";
import AgentContactList from "@/app/open-queue/agent-contact-list";
import styles from "@/app/open-queue/page.module.css";

export const dynamic = "force-dynamic";

export default async function OpenQueuePage({ searchParams }: { searchParams?: Promise<{ offset?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "agent" || !session.companyId) redirect(session.isSuperAdmin ? "/super-admin" : "/dashboard");
  const query = searchParams ? await searchParams : {};
  const requestedOffset = Number(query.offset ?? 0);
  const offset = Number.isInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
  let queue: Awaited<ReturnType<typeof listContactsForAgent>> | null = null;
  try {
    queue = await listContactsForAgent({ companyId: session.companyId, agentId: session.id, limit: 100, offset });
  } catch {
    queue = null;
  }
  const previousHref = offset > 0 ? `/open-queue?offset=${Math.max(0, offset - 100)}` : null;
  const nextHref = queue?.nextOffset !== null && queue?.nextOffset !== undefined ? `/open-queue?offset=${queue.nextOffset}` : null;

  return (
    <WorkspaceShell session={session} section="contacts" title="My contacts" subtitle="Your assigned contacts that are ready for a call.">
      {!queue ? <div className={styles.notice} role="alert"><strong>Contacts are temporarily unavailable</strong><p>Assigned company contacts could not be loaded. Ask an administrator to check company access.</p></div> : (
        <AgentContactList contacts={queue.contacts} previousHref={previousHref} nextHref={nextHref} sourcePage={Math.floor(offset / 100) + 1} />
      )}
    </WorkspaceShell>
  );
}
