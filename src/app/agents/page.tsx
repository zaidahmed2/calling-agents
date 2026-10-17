import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace-shell";
import { getSession } from "@/lib/session";
import AgentsManager from "@/app/agents/agents-manager";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.isSuperAdmin) redirect("/super-admin");
  if (session.role !== "admin") redirect("/open-queue");

  return <WorkspaceShell session={session} section="agents" title="Agents" subtitle="Invite teammates and manage access to your company workspace.">
    <AgentsManager />
  </WorkspaceShell>;
}