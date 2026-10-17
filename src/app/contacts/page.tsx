import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace-shell";
import type { GhlContact } from "@/lib/ghl-contact-data";
import { listCompanyContacts } from "@/lib/contacts";
import { getSession } from "@/lib/session";
import { getLatestCallDatesByContact } from "@/lib/contact-history";
import { listAssignableAgents } from "@/lib/assignable-agents";
import ContactsManager from "@/app/contacts/contacts-manager";

type ContactCursor = { startAfter: string | null; startAfterId: string | null };

export const dynamic = "force-dynamic";

export default async function ContactsManagementPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");
  if (!session.companyId) redirect("/login?access=denied");

  let initialData: {
    nextCursor: ContactCursor | null;
    total: number;
    contacts: Array<GhlContact & { lastCallAt: string | null }>;
    agents: Array<{ id: string; email: string; ghlUserId: string; name: string }>;
    statusFieldConfigured: boolean;
  } = { contacts: [], nextCursor: null, total: 0, agents: [], statusFieldConfigured: true };
  let initialError = "";

  try {
    const [page, agents] = await Promise.all([
      listCompanyContacts({ companyId: session.companyId, limit: 25 }),
      listAssignableAgents(),
    ]);
    const lastCallDates = await getLatestCallDatesByContact(page.contacts.map((contact) => contact.id));
    initialData = {
      ...initialData,
      contacts: page.contacts.map((contact) => ({ ...contact, lastCallAt: lastCallDates[contact.id] ?? null })),
      nextCursor: page.nextOffset === null ? null : { startAfter: String(page.nextOffset), startAfterId: "offset" },
      total: page.total,
      agents: agents.map((agent) => ({ ...agent, ghlUserId: agent.id })),
    };
  } catch {
    initialError = "Could not load company contacts and agents.";
  }

  return <WorkspaceShell session={session} section="contacts" title="Contacts" subtitle="Create, import, assign, and manage company contacts."><ContactsManager initialData={initialData} initialError={initialError} /></WorkspaceShell>;
}