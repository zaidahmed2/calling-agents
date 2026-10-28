type SupabaseAuthErrorLike = {
  code?: string;
  status?: number;
  message?: string;
};

export function normalizeOtpCode(value: string): string {
  return value.trim();
}

export function isNumericOtp(value: string): boolean {
  return /^\d{1,32}$/.test(value);
}

function authErrorDetails(error: unknown): SupabaseAuthErrorLike {
  if (!error || typeof error !== "object") return {};
  const candidate = error as SupabaseAuthErrorLike;
  return {
    code: typeof candidate.code === "string" ? candidate.code.toLowerCase() : undefined,
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    message: typeof candidate.message === "string" ? candidate.message.toLowerCase() : undefined,
  };
}

export function otpRequestErrorMessage(error: unknown): string {
  const details = authErrorDetails(error);
  if (details.status === 429 || details.code?.includes("rate_limit")) {
    return "Too many OTP requests. Wait a few minutes before requesting another code.";
  }

  return "You are not authorized to log in to this system. Contact your administrator if you believe this is a mistake.";
}

export function otpVerificationErrorMessage(error: unknown): string {
  const details = authErrorDetails(error);
  if (details.status === 429 || details.code?.includes("rate_limit")) {
    return "Too many verification attempts. Wait a few minutes before trying again.";
  }

  if (details.code?.includes("expired") || details.message?.includes("expired")) {
    return "This code has expired. Request a new code and use the latest email.";
  }

  return "You are not authorized to log in to this system. Contact your administrator if you believe this is a mistake.";
}