import { NextResponse } from "next/server";

import { createRateLimiter, isWithinRateLimit } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { createSupabaseServiceClient } from "@/lib/supabase-service";
import { decryptDatabaseCredentials } from "@/lib/database-secrets";
import { createExternalClient, getCompanyDatabaseMetadata, projectRefFromUrl, TENANT_SCHEMA_VERSION } from "@/lib/company-database";
import { tenantMigrations } from "@/lib/tenant-migration-catalog";

export const dynamic = "force-dynamic";

const migrationLimiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
const noStore = { "Cache-Control": "no-store, private", Pragma: "no-cache" };

async function getTenantTarget(companyId: string) {
  const metadata = await getCompanyDatabaseMetadata(companyId);
  if (metadata.database_mode !== "external") return { metadata, client: null, projectRef: null };

  const central = createSupabaseServiceClient();
  const { data, error } = await central.from("company_database_secrets")
    .select("credentials_ciphertext")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !data?.credentials_ciphertext) throw new Error("Company database credentials are unavailable.");
  const credentials = decryptDatabaseCredentials(data.credentials_ciphertext);
  const projectRef = projectRefFromUrl(credentials.projectUrl);
  if (metadata.project_ref && metadata.project_ref !== projectRef) throw new Error("Company database project reference does not match its saved URL.");
  return { metadata, client: createExternalClient(credentials), projectRef };
}

async function getAppliedVersions(client: NonNullable<Awaited<ReturnType<typeof getTenantTarget>>["client"]>) {
  const { data, error } = await client.from("tenant_schema_migrations").select("version");
  if (error) throw new Error("Tenant migration status could not be read. Apply the initial tenant schema migration first.");
  return new Set((data ?? []).map((row) => row.version));
}

async function updateCentralMigrationStatus(companyId: string) {
  const central = createSupabaseServiceClient();
  const { error } = await central.from("company_databases").update({
    tenant_schema_version: TENANT_SCHEMA_VERSION,
    migration_status: "current",
    connection_status: "ready",
    last_migration_at: new Date().toISOString(),
    provisioning_error_category: null,
  }).eq("company_id", companyId).eq("database_mode", "external");
  if (error) throw new Error("Tenant updated, but central migration status could not be refreshed. Reload the page and check again.");
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401, headers: noStore });
  if (!session.companyId || !["admin", "agent"].includes(session.role)) {
    return NextResponse.json({ error: "Company access is required." }, { status: 403, headers: noStore });
  }

  try {
    const target = await getTenantTarget(session.companyId);
    if (!target.client) return NextResponse.json({ required: false, shared: true }, { headers: noStore });
    const versions = await getAppliedVersions(target.client);
    const applied = versions.has(TENANT_SCHEMA_VERSION);
    const required = !applied || target.metadata.tenant_schema_version !== TENANT_SCHEMA_VERSION || target.metadata.migration_status !== "current";
    return NextResponse.json({
      required,
      version: TENANT_SCHEMA_VERSION,
      applied,
      canApply: session.role === "admin" && (applied || Boolean(env.supabaseManagementApiToken)),
      admin: session.role === "admin",
      missingToken: !applied && !env.supabaseManagementApiToken,
    }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Tenant migration status could not be checked.",
    }, { status: 503, headers: noStore });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in is required." }, { status: 401, headers: noStore });
  if (!session.companyId || session.role !== "admin") {
    return NextResponse.json({ error: "Company administrator access is required to update its database." }, { status: 403, headers: noStore });
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Migration updates must be started from this application." }, { status: 403, headers: noStore });
  }
  if (!isWithinRateLimit(migrationLimiter, session.companyId)) {
    return NextResponse.json({ error: "A database update is already being attempted. Wait a minute and try again." }, { status: 429, headers: noStore });
  }

  try {
    const target = await getTenantTarget(session.companyId);
    if (!target.client || !target.projectRef) {
      return NextResponse.json({ required: false, shared: true }, { headers: noStore });
    }
    const appliedVersions = await getAppliedVersions(target.client);
    const pendingMigrations = tenantMigrations.filter((migration) => !appliedVersions.has(migration.version));

    if (pendingMigrations.length && !appliedVersions.has("20261018_000001")) {
      return NextResponse.json({
        error: "The initial tenant schema has not been installed. Ask your Super Admin to connect this database before applying incremental updates.",
      }, { status: 409, headers: noStore });
    }
    if (pendingMigrations.length && !env.supabaseManagementApiToken) {
      return NextResponse.json({
        error: "Automatic database updates are not enabled on this server. Set SUPABASE_MANAGEMENT_API_TOKEN in the app hosting environment.",
      }, { status: 503, headers: noStore });
    }

    for (const migration of pendingMigrations) {
      const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(target.projectRef)}/database/query`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.supabaseManagementApiToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query: migration.sql }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const details = (await response.text()).slice(0, 400);
        return NextResponse.json({
          error: `Supabase could not apply migration ${migration.version} (HTTP ${response.status}).${details ? ` ${details}` : ""}`,
        }, { status: 502, headers: noStore });
      }
      const { error } = await target.client.from("tenant_schema_migrations").upsert({ version: migration.version }, { onConflict: "version" });
      if (error) {
        return NextResponse.json({
          error: `Migration ${migration.version} ran, but its applied-version record could not be saved. Retry the update safely.`,
        }, { status: 503, headers: noStore });
      }
    }

    const versions = await getAppliedVersions(target.client);
    if (!versions.has(TENANT_SCHEMA_VERSION)) {
      return NextResponse.json({ error: "The tenant database did not report the required schema version after the update." }, { status: 503, headers: noStore });
    }
    await updateCentralMigrationStatus(session.companyId);
    return NextResponse.json({ required: false, version: TENANT_SCHEMA_VERSION, applied: true }, { headers: noStore });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Tenant migration could not be applied.",
    }, { status: 503, headers: noStore });
  }
}
