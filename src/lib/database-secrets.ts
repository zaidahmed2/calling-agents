import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { env } from "@/lib/env";

export type DatabaseCredentials = {
  projectUrl: string;
  publishableKey?: string;
  serviceRoleKey: string;
  managementApiToken?: string;
};

function encryptionKey(): Buffer {
  const value = env.integrationEncryptionKey.trim();
  if (!value) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured.");
  const key = /^[0-9a-f]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("INTEGRATION_ENCRYPTION_KEY must encode exactly 32 bytes.");
  return key;
}

export function encryptDatabaseCredentials(credentials: DatabaseCredentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptDatabaseCredentials(encoded: string): DatabaseCredentials {
  const [version, ivValue, tagValue, ciphertextValue] = encoded.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored company database credentials are invalid.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (
    !parsed
    || typeof parsed !== "object"
    || Array.isArray(parsed)
    || typeof (parsed as Record<string, unknown>).projectUrl !== "string"
    || ((parsed as Record<string, unknown>).publishableKey !== undefined && typeof (parsed as Record<string, unknown>).publishableKey !== "string")
    || typeof (parsed as Record<string, unknown>).serviceRoleKey !== "string"
    || ((parsed as Record<string, unknown>).managementApiToken !== undefined && typeof (parsed as Record<string, unknown>).managementApiToken !== "string")
  ) {
    throw new Error("Stored company database credentials are invalid.");
  }
  return {
    ...(parsed as DatabaseCredentials),
    publishableKey: typeof (parsed as Record<string, unknown>).publishableKey === "string"
      ? (parsed as Record<string, string>).publishableKey
      : "",
  };
}
