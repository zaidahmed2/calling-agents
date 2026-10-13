import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace-shell";
import { listOpenContactsForAgent } from "@/lib/ghl";
import { getSession } from "@/lib/session";
import AgentContactList from "@/app/open-queue/agent-contact-list";
import styles from "@/app/open-queue/page.module.css";

export const dynamic = "force-dynamic";

type Cursor = { startAfter: string; startAfterId: string } | null;

function readHistory(value: string | undefined): Cursor[] {
  if (!value || value.length > 6000) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 40).map((item): Cursor => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return typeof record.startAfter === "string" && typeof record.startAfterId === "string"
        ? { startAfter: record.startAfter.slice(0, 200), startAfterId: record.startAfterId.slice(0, 200) }
        : null;
    });
  } catch {
    return [];
  }
}

function queueHref(cursor: Cursor, history: Cursor[]) {
  const params = new URLSearchParams();
  if (cursor) {
    params.set("startAfter", cursor.startAfter);
    params.set("startAfterId", cursor.startAfterId);
  }
  if (history.length) params.set("history", JSON.stringify(history));
  return `/open-queue${params.size ? `?${params}` : ""}`;
}

function queueUnavailableMessage(blocker: string | undefined, hasUserMapping: boolean): string {
  if (!hasUserMapping) {
    return "Your login is not linked to your calling account yet. Ask an administrator to connect your work profile before contacts can appear here.";
  }
  if (blocker?.includes("GHL_CONTACT_STATUS_FIELD_KEY") || blocker?.toLowerCase().includes("status field")) {
    return "Contact status matching is not configured yet. Ask an administrator to finish workspace setup.";
  }
  if (blocker?.includes("HTTP 401") || blocker?.includes("HTTP 403")) {
    return "Contact access could not be verified. Ask an administrator to check your access and workspace connection.";
  }
  return "Assigned contacts could not be loaded right now. Ask an administrator to check the workspace connection.";
}

export default async function OpenQueuePage({ searchParams }: { searchParams?: Promise<{ startAfter?: string; startAfterId?: string; history?: string }> }) {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  const query = searchParams ? await searchParams : {};
  const history = readHistory(query.history);
  const cursor: Cursor = query.startAfter && query.startAfterId
    ? { startAfter: query.startAfter, startAfterId: query.startAfterId }
    : null;
  const queue = session.ghlUserId
    ? await listOpenContactsForAgent({ assignedUserId: session.ghlUserId, limit: 100, cursor })
    : { contacts: [], blocked: true as const, blocker: "Your GHL user mapping is not configured. Contact an administrator.", nextCursor: null, hasMore: false, total: null };

  const previousCursor = history.at(-1) ?? null;
  const previousHref = history.length ? queueHref(previousCursor, history.slice(0, -1)) : null;
  const nextCursor: Cursor = queue.nextCursor?.startAfter && queue.nextCursor.startAfterId
    ? { startAfter: queue.nextCursor.startAfter, startAfterId: queue.nextCursor.startAfterId }
    : null;
  const nextHref = nextCursor ? queueHref(nextCursor, [...history, cursor]) : null;

  return (
    <WorkspaceShell session={session} section="contacts" title="My contacts" subtitle="Your assigned contacts that are ready for a call.">
      {queue.blocked ? <div className={styles.notice} role="alert"><strong>Contacts are temporarily unavailable</strong><p>{queueUnavailableMessage(queue.blocker, Boolean(session.ghlUserId))}</p></div> : (
        <AgentContactList contacts={queue.contacts} previousHref={previousHref} nextHref={nextHref} sourcePage={history.length + 1} />
      )}
    </WorkspaceShell>
  );
}
