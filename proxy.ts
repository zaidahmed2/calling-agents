import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function isPublicPath(pathname: string) {
  return pathname === "/login"
    || pathname.startsWith("/api/webhooks/")
    || pathname.startsWith("/_next/")
    || pathname === "/favicon.ico";
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");

  if (isPublicPath(pathname)) {
    return NextResponse.next({ request });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return isApi
      ? NextResponse.json({ error: "Authentication is not configured." }, { status: 503 })
      : NextResponse.redirect(new URL("/login?setup=required", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    if (isApi) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("app_role, is_active, normalized_email")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.is_active || profile.normalized_email !== user.email?.trim().toLowerCase()) {
    await supabase.auth.signOut();
    return isApi
      ? NextResponse.json({ error: "Application access is not enabled." }, { status: 403 })
      : NextResponse.redirect(new URL("/login?access=denied", request.url));
  }

  if ((pathname.startsWith("/dashboard") || pathname.startsWith("/settings")) && profile.app_role !== "admin") {
    return NextResponse.redirect(new URL("/open-queue", request.url));
  }

  if ((pathname.startsWith("/sessions") || pathname.startsWith("/dispositions")) && profile.app_role !== "admin") {
    return NextResponse.redirect(new URL("/open-queue", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};