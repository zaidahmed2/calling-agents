import { NextResponse } from "next/server";

import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { createCompanyCrmClient } from "@/lib/company-database";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

const commentLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
const contactIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getCommentsClient(companyId: string) {
  const { client, mode } = await createCompanyCrmClient(companyId);
  return mode === "shared" ? createSupabaseServiceClient() : client;
}

async function authorizeContact(contactId: string, companyId: string, actorId: string, role: string) {
  if (!contactIdPattern.test(contactId)) return null;
  const client = await getCommentsClient(companyId);
  const { data, error } = await client.from("contacts")
    .select("id, assigned_agent_id")
    .eq("id", contactId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !data || (role === "agent" && data.assigned_agent_id !== actorId)) return null;
  return client;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (!session.companyId || !["agent", "admin"].includes(session.role)) {
    return NextResponse.json({ error: "Company agent or administrator access is required." }, { status: 403 });
  }
  try {
    const { id } = await params;
    const client = await authorizeContact(id, session.companyId, session.id, session.role);
    if (!client) return NextResponse.json({ error: "This contact is not available to you." }, { status: 404 });
    const { data, error } = await client.from("activity_logs")
      .select("id, actor_id, metadata, created_at")
      .eq("company_id", session.companyId)
      .eq("event_type", "contact_comment_added")
      .eq("target_type", "contact")
      .eq("target_id", id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return NextResponse.json({ error: "Comments could not be loaded." }, { status: 503 });
    const comments = (data ?? []).flatMap((row) => {
      const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
      return typeof metadata.comment === "string" ? [{
        id: row.id,
        author: row.actor_id === session.id ? "You" : "Team member",
        comment: metadata.comment,
        createdAt: row.created_at,
      }] : [];
    }).reverse();
    return NextResponse.json({ comments }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Comments could not be loaded." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (!session.companyId || !["agent", "admin"].includes(session.role)) {
    return NextResponse.json({ error: "Company agent or administrator access is required." }, { status: 403 });
  }
  if (!isWithinRateLimit(commentLimiter, session.id)) {
    return NextResponse.json({ error: "Too many comments. Wait a minute and try again." }, { status: 429 });
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter a valid comment." }, { status: 400 });
  }
  const comment = payload && typeof payload === "object" && !Array.isArray(payload)
    && typeof (payload as Record<string, unknown>).comment === "string"
    ? (payload as { comment: string }).comment.trim()
    : "";
  if (!comment || comment.length > 2000) {
    return NextResponse.json({ error: "A comment of 1 to 2,000 characters is required." }, { status: 400 });
  }
  try {
    const { id } = await params;
    const client = await authorizeContact(id, session.companyId, session.id, session.role);
    if (!client) return NextResponse.json({ error: "This contact is not available to you." }, { status: 404 });
    const { data, error } = await client.from("activity_logs").insert({
      company_id: session.companyId,
      actor_id: session.id,
      event_type: "contact_comment_added",
      target_type: "contact",
      target_id: id,
      metadata: { comment },
    }).select("id, created_at").single();
    if (error || !data) return NextResponse.json({ error: "Comment could not be saved." }, { status: 503 });
    return NextResponse.json({
      comment: { id: data.id, author: "You", comment, createdAt: data.created_at },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Comment could not be saved." }, { status: 503 });
  }
}
