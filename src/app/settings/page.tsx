import { redirect } from "next/navigation";

import { WorkspaceShell } from "@/components/workspace-shell";
import { getSession } from "@/lib/session";
import { env } from "@/lib/env";
import SettingsConsole from "@/app/settings/settings-console";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/open-queue");

  const configuration = {
    supabase: {
      url: Boolean(env.supabaseUrl),
      publishableKey: Boolean(env.supabaseAnonKey),
    },
    ghl: {
      privateIntegrationKey: Boolean(env.ghlPrivateIntegrationKey),
      locationId: Boolean(env.ghlLocationId),
      statusFieldKey: Boolean(env.ghlContactStatusFieldKey),
      webhookSecret: Boolean(env.ghlWebhookSecret),
    },
    crazytel: {
      baseUrl: Boolean(env.crazytelApiBaseUrl),
      apiKey: Boolean(env.crazytelApiKey),
      webRtcConfigured: Boolean(env.crazytelWebrtcSipUri && env.crazytelWebrtcPassword && env.crazytelOutboundUriTemplate),
      webhookSecret: Boolean(env.crazytelWebhookSecret),
      callerId: Boolean(env.crazytelCallerId),
      webrtcSipUri: Boolean(env.crazytelWebrtcSipUri),
      webrtcPassword: Boolean(env.crazytelWebrtcPassword),
      outboundUriTemplate: Boolean(env.crazytelOutboundUriTemplate),
      turnCredentials: Boolean(env.crazytelTurnUsername && env.crazytelTurnPassword),
    },
  };

  return <WorkspaceShell session={session} section="settings" title="Settings" subtitle="Check service readiness without exposing stored credentials."><SettingsConsole configuration={configuration} /></WorkspaceShell>;
}