import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "agent" || !session.companyId) {
    return NextResponse.json({ error: "This contact is not available." }, { status: 404 });
  }
  return NextResponse.json({ error: "Phone number viewing is disabled. Use the in-app call button instead." }, { status: 403 });
}