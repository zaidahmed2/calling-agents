import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getCompanyCallingConfig } from "@/lib/calling-provider";
import { getOpenContactForAgent } from "@/lib/contacts";
import { type CallStage } from "@/lib/ghl";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { auditAgentPhoneReveal, recordAgentWorkActivity } from "@/lib/work-session-activity";
import { createCompanyCrmClient } from "@/lib/company-database";
import { getAgentContactFields } from "@/lib/agent-contact-fields";

export const dynamic = "force-dynamic";
const callLimiter = createRateLimiter({ limit: Math.max(1, env.callInitRateLimitPerMinute), windowMs: 60_000 });

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "agent" || !session.companyId) return NextResponse.json({ error: "This contact is not available." }, { status: 404 });
  if (!isWithinRateLimit(callLimiter, session.id)) return NextResponse.json({ error: "Call actions are temporarily limited. Try again shortly." }, { status: 429 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid call action." }, { status: 400 }); }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const action = body.action;

  if (action === "start") {
    const contactId = typeof body.contactId === "string" ? body.contactId : "";
    if (!(await getAgentContactFields(session.companyId, session.id)).includes("phone")) {
      return NextResponse.json({ error: "Your administrator has not enabled phone-number access for you." }, { status: 403 });
    }
    const contact = await getOpenContactForAgent(contactId, session.companyId, session.id);
    if (!contact?.phone) return NextResponse.json({ error: "This contact is not available for a call." }, { status: 404 });
    if (!await auditAgentPhoneReveal(contact.id, session.companyId, session.id)) return NextResponse.json({ error: "Call access could not be verified." }, { status: 503 });

    const webRtc = await getCompanyCallingConfig(session.companyId, session.id, contact.phone);
    if (!webRtc.ok) return NextResponse.json({ error: webRtc.reason }, { status: 503 });

    try {
      const { client: crm, mode } = await createCompanyCrmClient(session.companyId);
      const rpcClient = mode === "shared" ? createSupabaseServiceClient() : crm;
      const args = mode === "shared"
        ? { p_agent_id: session.id, p_contact_id: contact.id }
        : { p_company_id: session.companyId, p_agent_id: session.id, p_contact_id: contact.id };
      const { data, error } = await rpcClient.rpc("start_company_agent_call", args);
      if (error) return NextResponse.json({ error: "Calling is not ready yet. Contact your administrator." }, { status: 503 });
      await recordAgentWorkActivity();
      return NextResponse.json({ call: data, telephony: webRtc.config }, { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });
    } catch {
      return NextResponse.json({ error: "Could not start this call log." }, { status: 503 });
    }
  }

  if (action === "provider-state") {
    const callId = typeof body.callId === "string" ? body.callId : "";
    const providerCallId = typeof body.providerCallId === "string" ? body.providerCallId.trim() : "";
    const providerState = body.providerState;
    if (!callId || !providerCallId || providerCallId.length > 255 || !["ringing", "answered"].includes(String(providerState))) {
      return NextResponse.json({ error: "Invalid Crazytel call state." }, { status: 400 });
    }

    try {
      const { client: crm, mode } = await createCompanyCrmClient(session.companyId);
      const { data: call, error: callError } = await crm.from("calls")
        .select("id, internal_contact_id, call_source, current_state, ended_at")
        .eq("id", callId).eq("company_id", session.companyId).eq("agent_id", session.id).maybeSingle();
      if (callError || !call || call.call_source !== "agent_reported" || call.ended_at || !["requested", "ringing", "answered"].includes(call.current_state)) {
        return NextResponse.json({ error: "This call is no longer active." }, { status: 404 });
      }
      const rpcClient = mode === "shared" ? createSupabaseServiceClient() : crm;
      const args = mode === "shared"
        ? { p_agent_id: session.id, p_call_id: callId, p_provider_call_id: providerCallId, p_provider_state: providerState }
        : { p_company_id: session.companyId, p_agent_id: session.id, p_call_id: callId, p_provider_call_id: providerCallId, p_provider_state: providerState };
      const { data, error } = await rpcClient.rpc("mark_company_agent_call", args);
      if (error) return NextResponse.json({ error: "The Crazytel call could not be linked to its call record. End the call and try again." }, { status: 503 });
      return NextResponse.json({ result: data }, { headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });
    } catch {
      return NextResponse.json({ error: "The Crazytel call state could not be saved." }, { status: 503 });
    }
  }

  if (action === "end") {
    const callId = typeof body.callId === "string" ? body.callId : "";
    if (!callId) return NextResponse.json({ error: "A call ID is required." }, { status: 400 });

    try {
      const { client: crm, mode } = await createCompanyCrmClient(session.companyId);
      const { data: call, error: callError } = await crm.from("calls")
        .select("id, internal_contact_id, agent_id, current_state, call_source, ended_at")
        .eq("id", callId).eq("company_id", session.companyId).eq("agent_id", session.id).maybeSingle();
      if (callError || !call || call.call_source !== "agent_reported" || !["requested", "ringing", "answered"].includes(call.current_state) || call.ended_at) {
        return NextResponse.json({ error: "This call is no longer active." }, { status: 404 });
      }
      const rpcClient = mode === "shared" ? createSupabaseServiceClient() : crm;
      const args = mode === "shared"
        ? { p_agent_id: session.id, p_call_id: callId }
        : { p_company_id: session.companyId, p_agent_id: session.id, p_call_id: callId };
      const { data, error } = await rpcClient.rpc("end_company_agent_call", args);
      if (error) return NextResponse.json({ error: "Call could not be ended. Try again or contact an administrator." }, { status: 503 });
      await recordAgentWorkActivity();
      return NextResponse.json({ result: data });
    } catch {
      return NextResponse.json({ error: "Call could not be ended." }, { status: 503 });
    }
  }

  if (action === "finish") {
    const callId = typeof body.callId === "string" ? body.callId : "";
    const outcome = typeof body.outcome === "string" ? body.outcome : "";
    const note = typeof body.note === "string" ? body.note : "";
    const callbackAt = typeof body.callbackAt === "string" && body.callbackAt ? body.callbackAt : null;
    const timezone = typeof body.timezone === "string" ? body.timezone : "";
    const stages: CallStage[] = ["picked", "not-picked", "call-later", "busy", "interested"];
    if (!callId || !stages.includes(outcome as CallStage)) {
      return NextResponse.json({ error: "Choose a valid call stage." }, { status: 400 });
    }
    if (outcome === "call-later" && (!callbackAt || !timezone || Number.isNaN(new Date(callbackAt).getTime()))) {
      return NextResponse.json({ error: "Choose a valid callback date and time." }, { status: 400 });
    }
    if (outcome !== "call-later" && callbackAt) {
      return NextResponse.json({ error: "A callback time is only valid for the Call later stage." }, { status: 400 });
    }
    if (note.length > 5000) {
      return NextResponse.json({ error: "Message must be 5,000 characters or fewer." }, { status: 400 });
    }

    try {
      const { client: crm, mode } = await createCompanyCrmClient(session.companyId);
      const { data: call, error: callError } = await crm.from("calls")
        .select("id, internal_contact_id, agent_id, current_state, call_source, ended_at")
        .eq("id", callId).eq("company_id", session.companyId).eq("agent_id", session.id).maybeSingle();
      if (callError || !call || call.call_source !== "agent_reported" || call.current_state !== "completed" || !call.ended_at) {
        return NextResponse.json({ error: "End the call before saving its result." }, { status: 409 });
      }
      const contact = call.internal_contact_id
        ? await getOpenContactForAgent(call.internal_contact_id, session.companyId, session.id)
        : null;
      if (!contact) {
        return NextResponse.json({ error: "Contact assignment or Open status changed; the call outcome cannot be saved." }, { status: 409 });
      }

      const rpcClient = mode === "shared" ? createSupabaseServiceClient() : crm;
      const sharedArgs = {
        p_agent_id: session.id,
        p_call_id: callId,
        p_outcome: outcome,
        p_note: note,
        p_callback_at: callbackAt ? new Date(callbackAt).toISOString() : null,
        p_timezone: callbackAt ? timezone : null,
      };
      const args = mode === "shared" ? sharedArgs : { ...sharedArgs, p_company_id: session.companyId };
      const { data, error } = await rpcClient.rpc("finish_company_agent_call", args);
      if (error) return NextResponse.json({ error: "Call outcome could not be saved. Try again or contact an administrator." }, { status: 503 });
      const ghlSync = { status: "not_configured" as const, reason: "Call results are saved in the company CRM. Configure GHL synchronization in company settings to export them." };
      await rpcClient.from("calls").update({ sync_state: "not_configured" }).eq("id", callId).eq("company_id", session.companyId).eq("agent_id", session.id);
      await recordAgentWorkActivity();
      return NextResponse.json({ result: data, ghlSync });
    } catch {
      return NextResponse.json({ error: "Call outcome could not be saved." }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "Unsupported call action." }, { status: 400 });
}