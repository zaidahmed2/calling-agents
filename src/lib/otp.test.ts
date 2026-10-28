import { describe, expect, it } from "vitest";

import { isNumericOtp, normalizeOtpCode, otpRequestErrorMessage, otpVerificationErrorMessage } from "./otp";

describe("OTP helpers", () => {
  it("trims the submitted code without changing leading zeroes", () => {
    expect(normalizeOtpCode(" 00123456 ")).toBe("00123456");
  });

  it("accepts numeric Supabase tokens of variable length", () => {
    expect(isNumericOtp("123456")).toBe(true);
    expect(isNumericOtp("0012345678")).toBe(true);
    expect(isNumericOtp("12 3456")).toBe(false);
    expect(isNumericOtp("12345x")).toBe(false);
    expect(isNumericOtp("" )).toBe(false);
  });

  it("reports request throttling without exposing provider error details", () => {
    expect(otpRequestErrorMessage({ status: 429 })).toMatch(/too many OTP requests/i);
    expect(otpRequestErrorMessage({ message: "secret provider response" })).not.toContain("secret provider response");
    expect(otpRequestErrorMessage({ message: "user not found in auth" })).toBe("You are not authorized to log in to this system. Contact your administrator if you believe this is a mistake.");
  });

  it("distinguishes expired codes and verification throttling", () => {
    expect(otpVerificationErrorMessage({ code: "otp_expired" })).toMatch(/expired/i);
    expect(otpVerificationErrorMessage({ status: 429 })).toMatch(/too many verification attempts/i);
    expect(otpVerificationErrorMessage({ message: "user not found in auth" })).toBe("You are not authorized to log in to this system. Contact your administrator if you believe this is a mistake.");
  });
});