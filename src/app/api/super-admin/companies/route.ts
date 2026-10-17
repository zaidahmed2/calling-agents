import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const createLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export async function GET() {
  const session = await getSession();
  if (!session?.isSuperAdmin) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.from("companies")
      .select("id, name, slug, initial_admin_email, status, created_at")
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: "Companies could not be loaded." }, { status: 503 });
    return NextResponse.json({ companies: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Companies could not be loaded." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.isSuperAdmin) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });
  if (!isWithinRateLimit(createLimiter, session.id)) return NextResponse.json({ error: "Too many company invitations. Try again shortly." }, { status: 429 });

  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid company request." }, { status: 400 }); }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.adminEmail === "string" ? body.adminEmail.trim().toLowerCase() : "";
  if (name.length < 2 || name.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a company name and valid administrator email." }, { status: 400 });
  }

  let service;
  try { service = createSupabaseServiceClient(); } catch {
    return NextResponse.json({ error: "Company onboarding requires server-side Supabase service credentials." }, { status: 503 });
  }

  const baseSlug = slugify(name) || "company";
  const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: company, error: companyError } = await service.from("companies").insert({
    name,
    slug,
    initial_admin_email: email,
    status: "active",
    created_by: session.id,
  }).select("id, name, slug, initial_admin_email, status, created_at").single();
  if (companyError || !company) return NextResponse.json({ error: "Company could not be created." }, { status: 503 });

  const rollbackCompany = async (userId?: string) => {
    if (userId) {
      await service.from("company_memberships").delete().eq("profile_id", userId);
      await service.from("profiles").delete().eq("id", userId);
      await service.auth.admin.deleteUser(userId);
    }
    await service.from("company_invitations").delete().eq("company_id", company.id);
    await service.from("companies").delete().eq("id", company.id);
  };

  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${env.appUrl}/login`,
  });
  if (inviteError || !invited.user) {
    await rollbackCompany();
    return NextResponse.json({ error: inviteError?.message.includes("already")
      ? "That email already has an Auth account. Use an unregistered administrator email for the initial invite."
      : "The administrator invitation could not be sent." }, { status: 409 });
  }

  const userId = invited.user.id;
  const { error: profileError } = await service.from("profiles").insert({
    id: userId,
    normalized_email: email,
    ghl_user_id: null,
    app_role: "admin",
    is_active: true,
  });
  if (profileError) {
    await rollbackCompany(userId);
    return NextResponse.json({ error: "The administrator profile could not be provisioned." }, { status: 503 });
  }

  const { error: membershipError } = await service.from("company_memberships").insert({
    profile_id: userId,
    company_id: company.id,
    role: "admin",
    is_active: true,
  });
  if (membershipError) {
    await rollbackCompany(userId);
    return NextResponse.json({ error: "The company administrator membership could not be provisioned." }, { status: 503 });
  }

  const { error: invitationError } = await service.from("company_invitations").insert({
    company_id: company.id,
    email,
    role: "admin",
    invited_by: session.id,
  });
  if (invitationError) {
    await rollbackCompany(userId);
    return NextResponse.json({ error: "The invitation record could not be saved." }, { status: 503 });
  }

  return NextResponse.json({ company }, { status: 201, headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session?.isSuperAdmin) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });
  let payload: unknown;
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Invalid company update." }, { status: 400 }); }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const id = typeof body.id === "string" ? body.id : "";
  const status = body.status;
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (!id || (status !== undefined && !["active", "inactive"].includes(String(status))) || (name !== undefined && (name.length < 2 || name.length > 160))) return NextResponse.json({ error: "Choose a company and valid update values." }, { status: 400 });
  const updates: Record<string, string> = {};
  if (status !== undefined) updates.status = status as string;
  if (name !== undefined) updates.name = name;
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "No company changes were supplied." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("companies").update(updates).eq("id", id).select("name, status").maybeSingle();
  if (error) return NextResponse.json({ error: "Company status could not be updated." }, { status: 503 });
  if (!data) return NextResponse.json({ error: "Company was not found." }, { status: 404 });
  return NextResponse.json({ ok: true, company: data });
}