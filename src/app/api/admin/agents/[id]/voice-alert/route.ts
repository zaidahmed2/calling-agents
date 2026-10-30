import { NextResponse } from "next/server";

import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getCompanyIntegration } from "@/lib/integration-secrets";
import { synthesizeGeminiTts } from "@/lib/gemini-tts";

export const dynamic = "force-dynamic";
const MIGRATION_ERROR = "Apply migration 20261029_000028_agent_voice_alert.sql to the central Supabase database.";

async function authorizeAgent(profileId: string, companyId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("company_memberships")
    .select("profile_id, voice_alert_enabled, voice_alert_text")
    .eq("profile_id", profileId).eq("company_id", companyId).eq("role", "agent").maybeSingle();
  if (error) {
    if (error.message.includes("voice_alert_enabled") || error.message.includes("voice_alert_text")) throw new Error(MIGRATION_ERROR);
    throw new Error("Agent membership could not be verified.");
  }
  return { supabase, membership: data };
}

function isMigrationError(error: unknown) {
  return error instanceof Error && error.message === MIGRATION_ERROR;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  try {
    const { id } = await params;
    const { membership } = await authorizeAgent(id, session.companyId);
    if (!membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    return NextResponse.json({
      settings: { enabled: membership.voice_alert_enabled, text: membership.voice_alert_text ?? "" },
    }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (isMigrationError(error)) return NextResponse.json({ error: MIGRATION_ERROR }, { status: 503 });
    console.error("Agent Voice Alert settings could not be loaded.", error);
    return NextResponse.json({ error: "Agent Voice Alert settings could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid Voice Alert settings." }, { status: 400 });
  }
  const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  const enabled = record.enabled;
  const text = record.text;
  if (typeof enabled !== "boolean" || typeof text !== "string" || text.length > 1000 || (enabled && !text.trim())) {
    return NextResponse.json({ error: "Enter an announcement of up to 1000 characters before enabling Voice Alert." }, { status: 400 });
  }
  try {
    const { id } = await params;
    const { supabase, membership } = await authorizeAgent(id, session.companyId);
    if (!membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    const { error } = await supabase.from("company_memberships").update({
      voice_alert_enabled: enabled,
      voice_alert_text: text.trim() || null,
    }).eq("profile_id", id).eq("company_id", session.companyId).eq("role", "agent");
    if (error) throw new Error("Agent Voice Alert settings could not be saved.");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (isMigrationError(error)) return NextResponse.json({ error: MIGRATION_ERROR }, { status: 503 });
    console.error("Agent Voice Alert settings could not be saved.", error);
    return NextResponse.json({ error: "Agent Voice Alert settings could not be saved." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  if (session.role !== "admin" || !session.companyId) return NextResponse.json({ error: "Company administrator access is required." }, { status: 403 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter announcement text to preview." }, { status: 400 });
  }
  const text = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).text
    : null;
  if (typeof text !== "string" || !text.trim() || text.length > 1000) {
    return NextResponse.json({ error: "Enter an announcement of up to 1000 characters to preview." }, { status: 400 });
  }
  try {
    const { id } = await params;
    const { membership } = await authorizeAgent(id, session.companyId);
    if (!membership) return NextResponse.json({ error: "This agent does not belong to your company." }, { status: 404 });
    const { credentials } = await getCompanyIntegration(session.companyId, "gemini");
    if (!credentials.apiKey) return NextResponse.json({ error: "Add this company’s Gemini API key under Settings & Integrations before previewing." }, { status: 409 });
    const audio = await synthesizeGeminiTts(text.trim(), credentials.apiKey);
    return NextResponse.json({ audio }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (previewError) {
    if (isMigrationError(previewError)) return NextResponse.json({ error: MIGRATION_ERROR }, { status: 503 });
    console.error("Agent Voice Alert preview could not be generated.", previewError);
    return NextResponse.json({ error: "Voice Alert preview could not be generated. Check the company Gemini API key and try again." }, { status: 503 });
  }
}
