"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { normalizeEmail } from "@/lib/auth";
import { env } from "@/lib/env";
import { isNumericOtp, normalizeOtpCode, otpRequestErrorMessage, otpVerificationErrorMessage } from "@/lib/otp";
import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const otpLimiter = createRateLimiter({ limit: env.otpRateLimitPerMinute, windowMs: 60_000 });
const verifyLimiter = createRateLimiter({ limit: env.otpRateLimitPerMinute, windowMs: 60_000 });

export async function requestOtp(_prevState: unknown, formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      ok: false,
      message: "Enter a valid work email address.",
    };
  }

  const requestHeaders = await headers();
  const source = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!isWithinRateLimit(otpLimiter, `${source}:${email}`)) {
    return { ok: false, message: "Too many requests. Wait a minute before trying again." };
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
      },
    });

    if (error) {
      console.error("Supabase OTP request failed", { status: error.status, code: error.code });
      return { ok: false, message: otpRequestErrorMessage(error) };
    }
  } catch (error) {
    console.error("Supabase OTP request unavailable", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return {
      ok: false,
      message: "Sign-in service is unavailable. Check the Supabase URL/key configuration and try again.",
    };
  }

  return {
    ok: true,
    message: "If your account is provisioned, a sign-in code will be sent to that address.",
  };
}

export async function submitOtp(_prevState: unknown, formData: FormData) {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const code = normalizeOtpCode(String(formData.get("code") ?? ""));

  if (!email || !isNumericOtp(code)) {
    return {
      ok: false,
      message: "Enter the email address and the numeric code from the latest email.",
    };
  }

  const requestHeaders = await headers();
  const source = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!isWithinRateLimit(verifyLimiter, `${source}:${email}`)) {
    return { ok: false, message: "Too many attempts. Wait a minute before trying again." };
  }

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { ok: false, message: "Sign-in is temporarily unavailable. Contact your administrator." };
  }

  let data;
  let error;
  try {
    const result = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    data = result.data;
    error = result.error;
  } catch (verificationError) {
    console.error("Supabase OTP verification unavailable", {
      name: verificationError instanceof Error ? verificationError.name : "unknown",
    });
    return { ok: false, message: "Could not reach Supabase to verify the code. Check your connection and try again." };
  }

  if (error || !data.user) {
    console.error("Supabase OTP verification rejected", { status: error?.status, code: error?.code });
    return { ok: false, message: otpVerificationErrorMessage(error) };
  }

  let profile;
  let profileError;
  try {
    const result = await supabase
      .from("profiles")
      .select("platform_role, is_active, normalized_email")
      .eq("id", data.user.id)
      .maybeSingle();
    profile = result.data;
    profileError = result.error;
  } catch {
    await supabase.auth.signOut();
    return { ok: false, message: "Your code was verified, but the application access check failed. Contact the administrator." };
  }

  if (profileError) {
    console.error("Profile authorization check failed", { code: profileError.code });
    await supabase.auth.signOut();
    return { ok: false, message: "Your code was verified, but the application could not check your access. Contact the administrator." };
  }

  if (!profile?.is_active || profile.normalized_email !== email) {
    await supabase.auth.signOut();
    return { ok: false, message: "This account is not enabled for the application. Contact your administrator." };
  }

  if (profile.platform_role === "super_admin") redirect("/super-admin");

  const { data: membership, error: membershipError } = await supabase
    .from("company_memberships")
    .select("role, is_active, companies!inner(status)")
    .eq("profile_id", data.user.id)
    .eq("is_active", true)
    .maybeSingle();
  const company = membership?.companies as { status?: string } | null;
  if (membershipError || !membership || company?.status !== "active") {
    await supabase.auth.signOut();
    return { ok: false, message: "This account is not enabled for an active company. Contact your administrator." };
  }

  if (membership.role === "agent") {
    const { error: loginEventError } = await supabase.rpc("record_agent_login");
    if (loginEventError) {
      console.error("Agent sign-in event could not be recorded", { code: loginEventError.code });
    }
  }

  redirect(membership.role === "admin" ? "/dashboard" : "/open-queue");
}
