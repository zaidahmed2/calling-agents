"use client";

import { useState } from "react";

import styles from "@/app/settings/settings.module.css";

type Configuration = {
  supabase: { url: boolean; publishableKey: boolean };
  ghl: { privateIntegrationKey: boolean; locationId: boolean; webhookSecret: boolean; statusFieldKey: boolean };
  crazytel: { baseUrl: boolean; apiKey: boolean; webRtcConfigured: boolean; webhookSecret: boolean; callerId: boolean; webrtcSipUri: boolean; webrtcPassword: boolean; outboundUriTemplate: boolean; turnCredentials: boolean };
};

type TestResult = { state: "success" | "failure" | "blocked"; message: string; checkedAt: string };

function ConfigRow({ label, configured }: { label: string; configured: boolean }) {
  return <div className={styles.configRow}><span>{label}</span><span className={configured ? styles.present : styles.missing}>{configured ? "Configured" : "Missing"}</span></div>;
}

function IntegrationCard({
  id,
  title,
  description,
  configured,
  buttonLabel,
  disabled,
  children,
  result,
  onTest,
}: {
  id: string;
  title: string;
  description: string;
  configured: boolean;
  buttonLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
  result?: TestResult;
  onTest: (id: string) => void;
}) {
  return (
    <article className={styles.integrationCard}>
      <header className={styles.cardHeader}>
        <div className={`${styles.serviceIcon} ${styles[id]}`}>{id === "supabase" ? "S" : id === "ghl" ? "G" : "C"}</div>
        <div className={styles.serviceTitle}><h2>{title}</h2><p>{description}</p></div>
        <span className={configured ? styles.statusReady : styles.statusIncomplete}>{configured ? "Configured" : "Needs setup"}</span>
      </header>
      <div className={styles.configList}>{children}</div>
      <div className={styles.cardFooter}>
        {result ? <div className={`${styles.testResult} ${styles[result.state]}`} role="status"><strong>{result.checkedAt}</strong><span>{result.message}</span></div> : <span className={styles.noTest}>Credentials stay server-side and are never returned here.</span>}
        <button type="button" disabled={disabled} onClick={() => onTest(id)} className={styles.testButton}>{buttonLabel}</button>
      </div>
    </article>
  );
}

export default function SettingsConsole({ configuration }: { configuration: Configuration }) {
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});

  async function runTest(provider: string) {
    setTesting(provider);
    try {
      const response = await fetch("/api/admin/integrations/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const payload = await response.json() as { state?: TestResult["state"]; message?: string };
      setResults((current) => ({
        ...current,
        [provider]: {
          state: payload.state ?? "failure",
          message: payload.message ?? "The connection check did not complete.",
          checkedAt: new Date().toLocaleTimeString(),
        },
      }));
    } catch {
      setResults((current) => ({
        ...current,
        [provider]: { state: "failure", message: "Could not reach the local app endpoint.", checkedAt: new Date().toLocaleTimeString() },
      }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <section className={styles.securityBanner}>
        <span className={styles.lockIcon}>✓</span>
        <div><strong>Credentials are protected</strong><p>API keys are read from server environment variables. This page displays status only; secret values cannot be viewed or edited in the browser.</p></div>
        <span className={styles.envPill}>.ENV.LOCAL</span>
      </section>

      <div className={styles.sectionHeading}><div><h2>Connected services</h2><p>Run a live check where a safe, implemented provider request is available.</p></div><span>3 SERVICES</span></div>

      <div className={styles.integrationGrid}>
        <IntegrationCard id="supabase" title="Supabase" description="Authentication and application database" configured={configuration.supabase.url && configuration.supabase.publishableKey} buttonLabel={testing === "supabase" ? "Checking..." : "Test connection"} disabled={testing !== null} result={results.supabase} onTest={runTest}>
          <ConfigRow label="Project URL" configured={configuration.supabase.url} />
          <ConfigRow label="Publishable / anon key" configured={configuration.supabase.publishableKey} />
        </IntegrationCard>

        <IntegrationCard id="ghl" title="GoHighLevel" description="Contact access and assignment filtering" configured={configuration.ghl.privateIntegrationKey && configuration.ghl.locationId} buttonLabel={testing === "ghl" ? "Checking..." : "Test contact access"} disabled={testing !== null} result={results.ghl} onTest={runTest}>
          <ConfigRow label="Private Integration key" configured={configuration.ghl.privateIntegrationKey} />
          <ConfigRow label="Sub-account location ID" configured={configuration.ghl.locationId} />
          <ConfigRow label="Contact status field key" configured={configuration.ghl.statusFieldKey} />
          <ConfigRow label="Webhook signing secret" configured={configuration.ghl.webhookSecret} />
        </IntegrationCard>

        <IntegrationCard id="crazytel" title="Crazytel" description="Hybrid SIP WebRTC calling and API access" configured={configuration.crazytel.baseUrl && configuration.crazytel.apiKey && configuration.crazytel.webRtcConfigured} buttonLabel={testing === "crazytel" ? "Checking…" : "Test API key"} disabled={testing !== null} result={results.crazytel} onTest={runTest}>
          <ConfigRow label="Server API key" configured={configuration.crazytel.apiKey} />
          <ConfigRow label="Hybrid WebRTC SIP identity" configured={configuration.crazytel.webrtcSipUri} />
          <ConfigRow label="Dedicated WebRTC password" configured={configuration.crazytel.webrtcPassword} />
          <ConfigRow label="Outbound SIP URI format" configured={configuration.crazytel.outboundUriTemplate} />
          <ConfigRow label="TURN relay credentials (optional)" configured={configuration.crazytel.turnCredentials} />
          <ConfigRow label="Verified caller ID noted" configured={configuration.crazytel.callerId} />
          <ConfigRow label="Webhook signing secret" configured={configuration.crazytel.webhookSecret} />
          <p className={styles.warningText}>Browser SIP credentials are sent only to the signed-in agent to register WebRTC. Prefer a separate Hybrid trunk/login per agent. Confirm the outbound SIP URI template with Crazytel before placing a live call.</p>
        </IntegrationCard>
      </div>

      <section className={styles.bottomNote}><div><strong>Need to update a key?</strong><p>Edit the value in your local `.env.local` or deployment secret manager, then restart/redeploy the app before testing again.</p></div><a href="/docs/SUPABASE_SETUP.md" target="_blank" rel="noreferrer">Setup guide <span>↗</span></a></section>
    </>
  );
}