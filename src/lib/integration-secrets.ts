import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export type IntegrationProvider = "ghl" | "crazytel" | "gemini";
export type IntegrationConfig = {
  enabled: boolean;
  connection_status: "not_configured" | "connected" | "failed" | "disabled";
  settings: Record<string, unknown>;
  last_error: string | null;
  last_checked_at: string | null;
};

function encryptionKey(): Buffer {
  const value = env.integrationEncryptionKey.trim();
  if (!value) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured.");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must encode exactly 32 bytes.");
  return key;
}

export function encryptCredentials(credentials: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptCredentials(encoded: string): Record<string, string> {
  const [version, ivValue, tagValue, ciphertextValue] = encoded.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("Stored integration credentials are invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Stored integration credentials are invalid.");
  return parsed as Record<string, string>;
}

export async function getCompanyIntegration(companyId: string, provider: IntegrationProvider) {
  const service = createSupabaseServiceClient();
  const [{ data: config, error: configError }, { data: secret, error: secretError }] = await Promise.all([
    service.from("company_integrations").select("enabled, connection_status, settings, last_error, last_checked_at")
      .eq("company_id", companyId).eq("provider", provider).maybeSingle(),
    service.from("company_integration_secrets").select("credentials_ciphertext")
      .eq("company_id", companyId).eq("provider", provider).maybeSingle(),
  ]);
  if (configError || secretError) throw new Error("Company integration settings could not be loaded.");
  return {
    config: config as IntegrationConfig | null,
    credentials: secret?.credentials_ciphertext ? decryptCredentials(secret.credentials_ciphertext) : {},
  };
}

export async function saveCompanyCredentials(companyId: string, provider: IntegrationProvider, credentials: Record<string, string>) {
  if (!Object.values(credentials).some((value) => value.trim())) return;
  const service = createSupabaseServiceClient();
  const { data: stored, error: readError } = await service.from("company_integration_secrets")
    .select("credentials_ciphertext").eq("company_id", companyId).eq("provider", provider).maybeSingle();
  if (readError) throw new Error("Stored integration credentials could not be updated.");
  const existing = stored?.credentials_ciphertext ? decryptCredentials(stored.credentials_ciphertext) : {};
  const updated = { ...existing, ...Object.fromEntries(Object.entries(credentials).filter(([, value]) => value.trim())) };
  const { error } = await service.from("company_integration_secrets").upsert({
    company_id: companyId,
    provider,
    credentials_ciphertext: encryptCredentials(updated),
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_id,provider" });
  if (error) throw new Error("Integration credentials could not be stored.");
}
