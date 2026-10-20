import { NextResponse } from "next/server";

import { ADMIN_COMPANY_CONTEXT_COOKIE, isCompanyId } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.isSuperAdmin) {
    return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });
  }

  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Company admin access must be initiated from this application." }, { status: 403 });
  }

  const { id: companyId } = await params;
  if (!isCompanyId(companyId)) return NextResponse.json({ error: "Choose a valid company." }, { status: 400 });

  let companyIdToEnter: string;
  try {
    const supabase = await createSupabaseServerClient();
    const { data: company, error } = await supabase.from("companies")
      .select("id")
      .eq("id", companyId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Company access could not be verified." }, { status: 503 });
    if (!company) return NextResponse.json({ error: "Company was not found." }, { status: 404 });
    companyIdToEnter = company.id;
  } catch {
    return NextResponse.json({ error: "Company access could not be verified." }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(ADMIN_COMPANY_CONTEXT_COOKIE, companyIdToEnter, {
    httpOnly: true,
    maxAge: 60 * 60 * 8,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
