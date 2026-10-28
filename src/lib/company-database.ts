import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { decryptDatabaseCredentials, type DatabaseCredentials } from "@/lib/database-secrets";

export const TENANT_SCHEMA_VERSION = "20261029_000003";

export type CompanyDatabaseMode = "shared" | "external";
export type CompanyDatabaseMetadata = {
  company_id: string;
  database_mode: CompanyDatabaseMode;
  project_ref: string | null;
  connection_status: "pending" | "ready" | "failed" | "disabled";
  tenant_schema_version: string | null;
  migration_status: "pending" | "current" | "failed" | "unknown";
  last_connected_at: string | null;
  last_migration_at: string | null;
  provisioning_error_category: string | null;
};

export type CompanyCrmClient = {
  client: SupabaseClient;
  mode: CompanyDatabaseMode;
};

export function normalizeSupabaseProjectUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid Supabase project URL.");
  }

  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !/^[a-z0-9-]+\.supabase\.co$/i.test(parsed.hostname)
    || (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error("Use an HTTPS Supabase project URL such as https://project-ref.supabase.co.");
  }
  return parsed.origin;
}

export function supabaseProjectUrlFromRef(value: string): string {
  const projectRef = value.trim();
  if (!/^[a-z0-9-]+$/i.test(projectRef)) {
    throw new Error("Enter a valid Supabase project ID.");
  }
  return normalizeSupabaseProjectUrl(`https://${projectRef}.supabase.co`);
}

export function projectRefFromUrl(url: string): string {
  return new URL(normalizeSupabaseProjectUrl(url)).hostname.split(".")[0];
}

export async function getCompanyDatabaseMetadata(companyId: string): Promise<CompanyDatabaseMetadata> {
  const central = await createSupabaseServerClient();
  const { data, error } = await central.from("company_databases")
    .select("company_id, database_mode, project_ref, connection_status, tenant_schema_version, migration_status, last_connected_at, last_migration_at, provisioning_error_category")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) throw new Error("Company database configuration is unavailable.");
  return data as CompanyDatabaseMetadata;
}

export async function createCompanyCrmClient(companyId: string): Promise<CompanyCrmClient> {
  const metadata = await getCompanyDatabaseMetadata(companyId);
  if (metadata.connection_status !== "ready" || metadata.migration_status !== "current") {
    throw new Error("This company's CRM database is not ready.");
  }

  if (metadata.database_mode === "shared") {
    return { client: await createSupabaseServerClient(), mode: "shared" };
  }
  if (metadata.tenant_schema_version !== TENANT_SCHEMA_VERSION) {
    throw new Error("This company's CRM database schema is not current.");
  }

  const centralService = createSupabaseServiceClient();
  const { data, error } = await centralService.from("company_database_secrets")
    .select("credentials_ciphertext")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !data?.credentials_ciphertext) {
    throw new Error("Company database credentials are unavailable.");
  }

  const credentials = decryptDatabaseCredentials(data.credentials_ciphertext);
  return {
    client: createExternalClient(credentials),
    mode: "external",
  };
}

export function createExternalClient(credentials: DatabaseCredentials): SupabaseClient {
  const url = normalizeSupabaseProjectUrl(credentials.projectUrl);
  if (!credentials.serviceRoleKey.trim()) throw new Error("Company database service credentials are missing.");
  return createClient(url, credentials.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function checkExternalDatabase(credentials: DatabaseCredentials): Promise<void> {
  const client = createExternalClient(credentials);
  const { data, error } = await client.from("tenant_schema_migrations")
    .select("version")
    .eq("version", TENANT_SCHEMA_VERSION)
    .maybeSingle();
  if (error) {
    throw new Error("Tenant schema migration is missing or the project credentials cannot read it.");
  }
  if (!data) throw new Error("Tenant schema version is not current.");
}
