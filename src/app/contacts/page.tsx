import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace-shell";
import { env } from "@/lib/env";
import { getGhlContactStatusField, listGhlContactsPage, type GhlContact } from "@/lib/ghl";
import { getSession } from "@/lib/session";
import { getLatestCallDatesByContact } from "@/lib/contact-history";
import { listAssignableAgents } from "@/lib/assignable-agents";
import ContactsManager from "@/app/contacts/contacts-manager";

export const dynamic = "force-dynamic";

export default async function ContactsManagementPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");

  let initialData: {
    nextCursor: Awaited<ReturnType<typeof listGhlContactsPage>>["nextCursor"];
    total: number | null;
    contacts: Array<GhlContact & { lastCallAt: string | null }>;
    agents: Array<{ id: string; email: string; ghlUserId: string; name: string }>;
    statusFieldConfigured: boolean;
  } = { contacts: [], nextCursor: null, total: null, agents: [], statusFieldConfigured: false };
  let initialError = "";

  const [page, statusField] = await Promise.all([
    listGhlContactsPage({ limit: 25 }),
    env.ghlContactStatusFieldKey ? getGhlContactStatusField() : Promise.resolve(null),
  ]);
  if (page.blocked) initialError = page.blocker ?? "GHL contacts could not be loaded.";
  else {
    const lastCallDates = await getLatestCallDatesByContact(page.contacts.map((contact) => contact.id));
    initialData = { ...initialData, contacts: page.contacts.map((contact) => ({ ...contact, lastCallAt: lastCallDates[contact.id] ?? null })), nextCursor: page.nextCursor, total: page.total };
  }
  initialData.statusFieldConfigured = Boolean(statusField);

  try {
    initialData.agents = await listAssignableAgents();
  } catch {
    initialError = "Could not load authorized agent mappings.";
  }

  return <WorkspaceShell session={session} section="contacts" title="Contacts" subtitle="Manage contact assignments and status."><ContactsManager initialData={initialData} initialError={initialError} /></WorkspaceShell>;
}