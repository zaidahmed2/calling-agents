import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getGhlContact, getGhlContactStatusField, listGhlContactsPage, updateGhlContact, type GhlCursor } from "@/lib/ghl";
import { listAssignableAgents } from "@/lib/assignable-agents";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { getLatestCallDatesByContact } from "@/lib/contact-history";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const mutationLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

function authorizedError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return authorizedError(401, "Sign in is required.");
  if (session.role !== "admin") return authorizedError(403, "Administrator access is required.");

  const { searchParams } = new URL(request.url);
  const startAfter = searchParams.get("startAfter");
  const startAfterId = searchParams.get("startAfterId");
  const requestedLimit = Number(searchParams.get("limit") ?? 25);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 25;
  const cursor: GhlCursor | null = startAfter && startAfterId ? { startAfter, startAfterId } : null;
  const page = await listGhlContactsPage({ cursor, limit });
  if (page.blocked) return NextResponse.json({ error: page.blocker }, { status: 503 });

  let agents;
  try {
    agents = await listAssignableAgents();
  } catch {
    return NextResponse.json({ error: "Could not load authorized agent mappings." }, { status: 503 });
  }

  const statusField = env.ghlContactStatusFieldKey ? await getGhlContactStatusField() : null;
  const lastCallDates = await getLatestCallDatesByContact(page.contacts.map((contact) => contact.id));
  return NextResponse.json({
    contacts: page.contacts.map((contact) => ({ ...contact, lastCallAt: lastCallDates[contact.id] ?? null })),
    nextCursor: page.nextCursor,
    total: page.total,
    agents,
    statusFieldConfigured: Boolean(statusField),
  });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return authorizedError(401, "Sign in is required.");
  if (session.role !== "admin") return authorizedError(403, "Administrator access is required.");
  if (!isWithinRateLimit(mutationLimiter, session.id)) return authorizedError(429, "Too many contact changes. Wait a minute and try again.");

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return authorizedError(400, "Invalid JSON request.");
  }

  if (!payload || typeof payload !== "object") return authorizedError(400, "Invalid contact update.");
  const body = payload as Record<string, unknown>;
  const contactIds = Array.isArray(body.contactIds) ? [...new Set(body.contactIds.filter((value): value is string => typeof value === "string" && value.length > 0))] : [];
  const hasAssignee = Object.hasOwn(body, "assignedTo");
  const assignedTo = body.assignedTo;
  const status = body.status;

  if (contactIds.length === 0 || contactIds.length > 50) return authorizedError(400, "Select between 1 and 50 contacts.");
  if (!hasAssignee && status === undefined) return authorizedError(400, "Choose an assignment or status change.");
  if (hasAssignee && assignedTo !== null && typeof assignedTo !== "string") return authorizedError(400, "Invalid agent assignment.");
  if (status !== undefined && typeof status !== "string") return authorizedError(400, "Invalid contact status.");
  if (typeof status === "string" && (!status.trim() || status.trim().length > 80)) return authorizedError(400, "Status must contain 1 to 80 characters.");
  if (typeof status === "string" && !env.ghlContactStatusFieldKey) return authorizedError(503, "Set GHL_CONTACT_STATUS_FIELD_KEY before changing GHL contact status.");

  let allowedAssigneeIds: Set<string> | null = null;
  if (hasAssignee && assignedTo !== null) {
    try {
      const agents = await listAssignableAgents();
      allowedAssigneeIds = new Set(agents.map((agent) => agent.ghlUserId));
    } catch {
      return authorizedError(503, "Agent assignments could not be verified.");
    }
    if (!allowedAssigneeIds.has(assignedTo as string)) return authorizedError(400, "The selected assignee is not an active mapped agent.");
  }

  const results = await Promise.all(contactIds.map(async (contactId) => {
    const current = await getGhlContact(contactId);
    if (!current) return { contactId, ok: false, message: "Contact could not be revalidated in GHL." };
    const mutation = {
      ...(hasAssignee ? { assignedTo: assignedTo as string | null } : {}),
      ...(typeof status === "string" ? { status } : {}),
    };
    const result = await updateGhlContact(contactId, mutation);
    let assignmentHistorySaved: boolean | null = null;
    if (result.ok && hasAssignee && current.assignedUserId !== (assignedTo as string | null)) {
      try {
        const supabase = await createSupabaseServerClient();
        const { error } = await supabase.rpc("record_admin_contact_assignment", {
          p_contact_id: contactId,
          p_from_ghl_user_id: current.assignedUserId,
          p_to_ghl_user_id: assignedTo as string | null,
        });
        assignmentHistorySaved = !error;
      } catch {
        assignmentHistorySaved = false;
      }
    }
    return { contactId, ok: result.ok, message: result.reason ?? (assignmentHistorySaved === false ? "Updated in GHL, but assignment history could not be recorded. Apply the assignment history migration." : "Updated in GHL."), assignmentHistorySaved };
  }));

  const succeeded = results.filter((result) => result.ok).length;
  return NextResponse.json({ results, succeeded, failed: results.length - succeeded }, { status: succeeded === 0 ? 502 : 200 });
}