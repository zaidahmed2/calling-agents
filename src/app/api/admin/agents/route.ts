import { NextResponse } from "next/server";

import { listActiveAgentProfiles } from "@/lib/assignable-agents";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
    if (session.role !== "admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

    const agents = await listActiveAgentProfiles();

    return NextResponse.json({
      users: agents.map((agent) => ({
        id: agent.ghlUserId ?? agent.id,
        profileId: agent.id,
        name: agent.name,
        email: agent.email,
        role: "agent",
        isMappedAgent: Boolean(agent.ghlUserId),
        appEmail: agent.email,
      })),
      total: agents.length,
    });
  } catch {
    return NextResponse.json({ error: "Agent profiles could not be loaded. Check the database connection and try again." }, { status: 503 });
  }
}