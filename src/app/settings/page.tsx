import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace-shell";
import { getSession } from "@/lib/session";
import SettingsConsole from "@/app/settings/settings-console";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");

  return <WorkspaceShell session={session} section="settings" title="Settings" subtitle="Manage this company's integrations and calling provider."><SettingsConsole /></WorkspaceShell>;
}