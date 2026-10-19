import { NextResponse } from "next/server";

import { checkExternalDatabase, projectRefFromUrl, supabaseProjectUrlFromRef, TENANT_SCHEMA_VERSION } from "@/lib/company-database";
import { encryptDatabaseCredentials } from "@/lib/database-secrets";
import { getSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const dynamic = "force-dynamic";

async function getSetupCompany(companyId: string) {
  const central = await createSupabaseServerClient();
  const [{ data: company, error: companyError }, { data: database, error: databaseError }] = await Promise.all([
    central.from("companies").select("id, status").eq("id", companyId).maybeSingle(),
    central.from("company_databases").select("database_mode, project_ref").eq("company_id", companyId).maybeSingle(),
  ]);
  if (companyError || databaseError) return { error: "Company database settings could not be loaded.", status: 503 as const };
  if (!company || !database) return { error: "Company was not found.", status: 404 as const };
  if (company.status !== "setup" || database.database_mode !== "external") {
    return { error: "External database setup is only available for a company awaiting initial setup.", status: 409 as const };
  }
  return { company, database };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.isSuperAdmin) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });

  const { id: companyId } = await params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid company database configuration." }, { status: 400 });
  }
  const body = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (typeof body.projectRef !== "string" || typeof body.publishableKey !== "string" || typeof body.serviceRoleKey !== "string"
    || body.projectRef.length > 100 || body.publishableKey.length > 8192 || body.serviceRoleKey.length > 8192
    || !body.publishableKey.trim() || !body.serviceRoleKey.trim()) {
    return NextResponse.json({ error: "Enter the project ID, publishable key, and server-side service-role key." }, { status: 400 });
  }

  let projectUrl: string;
  let projectRef: string;
  try {
    projectUrl = supabaseProjectUrlFromRef(body.projectRef);
    projectRef = projectRefFromUrl(projectUrl);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid Supabase project URL." }, { status: 400 });
  }

  const setup = await getSetupCompany(companyId);
  if ("error" in setup) return NextResponse.json({ error: setup.error }, { status: setup.status });
  const credentials = { projectUrl, publishableKey: body.publishableKey, serviceRoleKey: body.serviceRoleKey };
  let credentialsCiphertext: string;
  try {
    credentialsCiphertext = encryptDatabaseCredentials(credentials);
  } catch (error) {
    if (error instanceof Error && error.message.includes("INTEGRATION_ENCRYPTION_KEY")) {
      return NextResponse.json({
        error: "The app server is missing a valid INTEGRATION_ENCRYPTION_KEY. Configure this server-side setting as a Base64 or 64-character hex encoding of exactly 32 random bytes, then restart or redeploy the app. This key is separate from the company Supabase project keys.",
      }, { status: 503 });
    }
    return NextResponse.json({ error: "The app could not encrypt the company database credentials." }, { status: 503 });
  }

  let service;
  try {
    service = createSupabaseServiceClient();
  } catch {
    return NextResponse.json({
      error: "The app server's central SUPABASE_SERVICE_ROLE_KEY is not configured. Set it in the app's server environment and restart or redeploy.",
    }, { status: 503 });
  }
  const { error: secretError } = await service.from("company_database_secrets").upsert({
    company_id: companyId,
    credentials_ciphertext: credentialsCiphertext,
    updated_at: new Date().toISOString(),
  }, { onConflict: "company_id" });
  if (secretError) return NextResponse.json({ error: "The app could not save encrypted credentials to its central database." }, { status: 503 });

  const { error: databaseUpdateError } = await service.from("company_databases").update({
    project_ref: projectRef,
    connection_status: "pending",
    migration_status: "pending",
    provisioning_error_category: null,
  }).eq("company_id", companyId);
  if (databaseUpdateError) return NextResponse.json({ error: "External database settings could not be saved to the central database." }, { status: 503 });
  return NextResponse.json({
    ok: true,
    database: {
      database_mode: "external",
      project_ref: projectRef,
      connection_status: "pending",
      tenant_schema_version: null,
      migration_status: "pending",
      last_connected_at: null,
      provisioning_error_category: null,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.isSuperAdmin) return NextResponse.json({ error: "Platform administrator access is required." }, { status: 403 });

  const { id: companyId } = await params;
  const setup = await getSetupCompany(companyId);
  if ("error" in setup) return NextResponse.json({ error: setup.error }, { status: setup.status });

  try {
    const service = createSupabaseServiceClient();
    const { data: secret, error: secretError } = await service.from("company_database_secrets")
      .select("credentials_ciphertext").eq("company_id", companyId).maybeSingle();
    if (secretError) return NextResponse.json({ error: "Saved database settings could not be loaded." }, { status: 503 });
    if (!secret?.credentials_ciphertext) return NextResponse.json({ error: "Save the project credentials before verifying the database." }, { status: 409 });

    const { decryptDatabaseCredentials } = await import("@/lib/database-secrets");
    const credentials = decryptDatabaseCredentials(secret.credentials_ciphertext);
    await checkExternalDatabase(credentials);

    const now = new Date().toISOString();
    const { error: databaseUpdateError } = await service.from("company_databases").update({
      connection_status: "ready",
      tenant_schema_version: TENANT_SCHEMA_VERSION,
      migration_status: "current",
      last_connected_at: now,
      last_migration_at: now,
      provisioning_error_category: null,
    }).eq("company_id", companyId);
    if (databaseUpdateError) return NextResponse.json({ error: "The database passed verification, but its status could not be saved." }, { status: 503 });

    const { error: activateError } = await service.from("companies").update({ status: "active" }).eq("id", companyId);
    if (activateError) return NextResponse.json({ error: "The database passed verification, but the company could not be activated." }, { status: 503 });
    return NextResponse.json({
      ok: true,
      database: {
        database_mode: "external",
        project_ref: setup.database.project_ref,
        connection_status: "ready",
        tenant_schema_version: TENANT_SCHEMA_VERSION,
        migration_status: "current",
        last_connected_at: now,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    try {
      const service = createSupabaseServiceClient();
      const { error } = await service.from("company_databases").update({
        connection_status: "failed",
        migration_status: "failed",
        provisioning_error_category: "connection_or_schema_check_failed",
      }).eq("company_id", companyId);
      if (error) return NextResponse.json({ error: "Verification failed and its status could not be updated." }, { status: 503 });
    } catch {
      return NextResponse.json({ error: "Verification failed and its status could not be updated." }, { status: 503 });
    }
    return NextResponse.json({
      error: `Connection or tenant schema verification failed. Apply tenant migration ${TENANT_SCHEMA_VERSION} and retry.`,
    }, { status: 409 });
  }
}
