import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeSupabaseProjectUrl, projectRefFromUrl, supabaseProjectUrlFromRef, TENANT_SCHEMA_VERSION } from "@/lib/company-database";

describe("company database URL validation", () => {
  it("accepts Supabase project URLs and normalizes their origin", () => {
    expect(normalizeSupabaseProjectUrl(" https://sample-ref.supabase.co/ ")).toBe("https://sample-ref.supabase.co");
    expect(projectRefFromUrl("https://sample-ref.supabase.co")).toBe("sample-ref");
  });

  it("builds the standard Supabase URL from a project ID", () => {
    expect(supabaseProjectUrlFromRef(" sample-ref ")).toBe("https://sample-ref.supabase.co");
    expect(() => supabaseProjectUrlFromRef("invalid/ref")).toThrow();
  });

  it.each([
    "http://sample-ref.supabase.co",
    "https://example.com",
    "https://user:password@sample-ref.supabase.co",
    "https://sample-ref.supabase.co/path",
    "https://sample-ref.supabase.co/?apikey=secret",
  ])("rejects unsafe or unsupported URL %s", (url) => {
    expect(() => normalizeSupabaseProjectUrl(url)).toThrow();
  });

  it("pins the tenant database readiness check to the shipped schema version", () => {
    expect(TENANT_SCHEMA_VERSION).toBe("20261029_000003");
  });
});

describe("encrypted database credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("round-trips project access values without exposing them in the ciphertext", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.resetModules();
    const { decryptDatabaseCredentials, encryptDatabaseCredentials } = await import("@/lib/database-secrets");
    const credentials = { projectUrl: "https://sample-ref.supabase.co", publishableKey: "sb_publishable_test", serviceRoleKey: "private-service-key" };
    const encrypted = encryptDatabaseCredentials(credentials);

    expect(encrypted).not.toContain(credentials.projectUrl);
    expect(encrypted).not.toContain(credentials.serviceRoleKey);
    expect(decryptDatabaseCredentials(encrypted)).toEqual(credentials);
  });

  it("encrypts and restores an optional company-specific Management API token", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 6).toString("base64"));
    vi.resetModules();
    const { decryptDatabaseCredentials, encryptDatabaseCredentials } = await import("@/lib/database-secrets");
    const token = "sbp_management_token_secret";
    const credentials = {
      projectUrl: "https://sample-ref.supabase.co",
      publishableKey: "sb_publishable_test",
      serviceRoleKey: "private-service-key",
      managementApiToken: token,
    };
    const encrypted = encryptDatabaseCredentials(credentials);

    expect(encrypted).not.toContain(token);
    expect(decryptDatabaseCredentials(encrypted)).toEqual(credentials);
  });

  it("rejects modified ciphertext", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    vi.resetModules();
    const { decryptDatabaseCredentials, encryptDatabaseCredentials } = await import("@/lib/database-secrets");
    const encrypted = encryptDatabaseCredentials({ projectUrl: "https://sample-ref.supabase.co", publishableKey: "sb_publishable_test", serviceRoleKey: "private-service-key" });
    const segments = encrypted.split(".");
    segments[2] = `${segments[2][0] === "A" ? "B" : "A"}${segments[2].slice(1)}`;
    const tampered = segments.join(".");

    expect(() => decryptDatabaseCredentials(tampered)).toThrow();
  });

  it("continues to read credentials saved before publishable keys were recorded", async () => {
    vi.stubEnv("INTEGRATION_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.resetModules();
    const { decryptDatabaseCredentials, encryptDatabaseCredentials } = await import("@/lib/database-secrets");
    const encrypted = encryptDatabaseCredentials({ projectUrl: "https://sample-ref.supabase.co", serviceRoleKey: "private-service-key" });

    expect(decryptDatabaseCredentials(encrypted)).toEqual({
      projectUrl: "https://sample-ref.supabase.co",
      publishableKey: "",
      serviceRoleKey: "private-service-key",
    });
  });
});
