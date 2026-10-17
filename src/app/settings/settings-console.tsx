"use client";

import { useEffect, useState } from "react";
import { Check, CircleHelp, Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import styles from "@/app/settings/settings.module.css";

type Provider = "ghl" | "crazytel";
type ProviderSettings = { enabled: boolean; connectionStatus: string; lastError: string | null; settings: Record<string, unknown> };
type ExternalField = { external_field_id: string; name: string; field_type: string | null; available: boolean };
type Mapping = { internalField: string; externalFieldId: string; syncDirection: string };
type SyncRun = { id: string; operation: string; state: string; imported_count: number; exported_count: number; skipped_count: number; failed_count: number; started_at: string; finished_at: string | null; details: Record<string, unknown> };
type ConsoleData = { integrations: { ghl: ProviderSettings | null; crazytel: ProviderSettings | null }; hasCredentials: Record<string, boolean>; fields: ExternalField[]; mappings: Array<{ internal_field: string; external_field_id: string; sync_direction: string }>; syncRuns: SyncRun[] };

const internalFields = [
  ["first_name", "First name"], ["last_name", "Last name"], ["phone", "Phone"], ["email", "Email"],
  ["status", "Status"], ["subject", "Subject"], ["notes", "Notes"], ["lead_source", "Lead source"],
] as const;
const standardFields: ExternalField[] = [
  { external_field_id: "standard:firstName", name: "First name", field_type: "TEXT", available: true },
  { external_field_id: "standard:lastName", name: "Last name", field_type: "TEXT", available: true },
  { external_field_id: "standard:phone", name: "Phone", field_type: "PHONE", available: true },
  { external_field_id: "standard:email", name: "Email", field_type: "EMAIL", available: true },
];

function emptyProvider(): ProviderSettings { return { enabled: false, connectionStatus: "not_configured", lastError: null, settings: {} }; }

export default function SettingsConsole() {
  const [data, setData] = useState<ConsoleData>({ integrations: { ghl: null, crazytel: null }, hasCredentials: {}, fields: [], mappings: [], syncRuns: [] });
  const [ghlKey, setGhlKey] = useState("");
  const [crazytelCredentials, setCrazytelCredentials] = useState({ apiKey: "", webrtcSipUri: "", webrtcPassword: "", turnUsername: "", turnPassword: "" });
  const [ghlSettings, setGhlSettings] = useState({ locationId: "", importEnabled: false, exportEnabled: false, exportUpdateExisting: false });
  const [crazytelSettings, setCrazytelSettings] = useState({ apiBaseUrl: "https://api.crazytel.io", websocketUrl: "wss://hybrid.sip.crazytel.net.au:8443", outboundUriTemplate: "", callerId: "" });
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testResults, setTestResults] = useState<Record<string, { state: string; message: string }>>({});

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/integrations", { cache: "no-store" });
      const result = await response.json() as ConsoleData & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Company settings could not be loaded.");
      setData(result);
      const ghl = result.integrations.ghl ?? emptyProvider();
      const crazytel = result.integrations.crazytel ?? emptyProvider();
      setGhlSettings({ locationId: String(ghl.settings.locationId ?? ""), importEnabled: Boolean(ghl.settings.importEnabled), exportEnabled: Boolean(ghl.settings.exportEnabled), exportUpdateExisting: Boolean(ghl.settings.exportUpdateExisting) });
      setCrazytelSettings({
        apiBaseUrl: String(crazytel.settings.apiBaseUrl ?? "https://api.crazytel.io"),
        websocketUrl: String(crazytel.settings.websocketUrl ?? "wss://hybrid.sip.crazytel.net.au:8443"),
        outboundUriTemplate: String(crazytel.settings.outboundUriTemplate ?? ""),
        callerId: String(crazytel.settings.callerId ?? ""),
      });
      setMappings(result.mappings.map((item) => ({ internalField: item.internal_field, externalFieldId: item.external_field_id, syncDirection: item.sync_direction })));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Company settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/integrations", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as ConsoleData & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Company settings could not be loaded.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setData(result);
        const ghl = result.integrations.ghl ?? emptyProvider();
        const crazytel = result.integrations.crazytel ?? emptyProvider();
        setGhlSettings({ locationId: String(ghl.settings.locationId ?? ""), importEnabled: Boolean(ghl.settings.importEnabled), exportEnabled: Boolean(ghl.settings.exportEnabled), exportUpdateExisting: Boolean(ghl.settings.exportUpdateExisting) });
        setCrazytelSettings({
          apiBaseUrl: String(crazytel.settings.apiBaseUrl ?? "https://api.crazytel.io"),
          websocketUrl: String(crazytel.settings.websocketUrl ?? "wss://hybrid.sip.crazytel.net.au:8443"),
          outboundUriTemplate: String(crazytel.settings.outboundUriTemplate ?? ""),
          callerId: String(crazytel.settings.callerId ?? ""),
        });
        setMappings(result.mappings.map((item) => ({ internalField: item.internal_field, externalFieldId: item.external_field_id, syncDirection: item.sync_direction })));
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Company settings could not be loaded.");
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function save(provider: Provider, enabled: boolean) {
    setBusy(`save-${provider}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/integrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider === "ghl"
          ? { provider, enabled, credentials: { privateIntegrationKey: ghlKey }, settings: ghlSettings }
          : { provider, enabled, credentials: crazytelCredentials, settings: crazytelSettings }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Integration settings could not be saved.");
      setNotice(`${provider === "ghl" ? "GoHighLevel" : "Crazytel"} settings saved. Secret values are not returned to this page.`);
      if (provider === "ghl") setGhlKey("");
      else setCrazytelCredentials({ apiKey: "", webrtcSipUri: "", webrtcPassword: "", turnUsername: "", turnPassword: "" });
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Integration settings could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function test(provider: Provider) {
    setBusy(`test-${provider}`);
    setError("");
    try {
      const response = await fetch("/api/admin/integrations/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
      const result = await response.json() as { state?: string; message?: string };
      setTestResults((current) => ({ ...current, [provider]: { state: result.state ?? "failure", message: result.message ?? "Connection check did not complete." } }));
      await load();
    } catch {
      setTestResults((current) => ({ ...current, [provider]: { state: "failure", message: "Could not reach the local app endpoint." } }));
    } finally {
      setBusy("");
    }
  }

  async function disconnect(provider: Provider) {
    setBusy(`disconnect-${provider}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/integrations", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Integration could not be disconnected.");
      setNotice(`${provider === "ghl" ? "GHL" : "Crazytel"} disconnected locally. Revoke the credential with the provider if required.`);
      await load();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Integration could not be disconnected.");
    } finally {
      setBusy("");
    }
  }

  async function refreshFields() {
    setBusy("fields");
    setError("");
    try {
      const response = await fetch("/api/admin/integrations/ghl/fields", { method: "POST" });
      const result = await response.json() as { fields?: ExternalField[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "GHL fields could not be retrieved.");
      setNotice(`${result.fields?.length ?? 0} GHL fields refreshed.`);
      await load();
    } catch (fieldError) {
      setError(fieldError instanceof Error ? fieldError.message : "GHL fields could not be retrieved.");
    } finally {
      setBusy("");
    }
  }

  async function saveMappings() {
    setBusy("mappings");
    setError("");
    try {
      const response = await fetch("/api/admin/integrations/ghl/mappings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: mappings.filter((item) => item.internalField && item.externalFieldId) }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "GHL mappings could not be saved.");
      setNotice("GHL field mappings saved.");
      await load();
    } catch (mappingError) {
      setError(mappingError instanceof Error ? mappingError.message : "GHL mappings could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function sync(action: "import" | "export") {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/integrations/ghl/sync", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, limit: 500 }),
      });
      const result = await response.json() as { imported?: number; exported?: number; skipped?: number; failed?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "GHL synchronization failed.");
      setNotice(action === "import"
        ? `Import complete: ${result.imported ?? 0} imported, ${result.skipped ?? 0} skipped, ${result.failed ?? 0} failed.`
        : `Export complete: ${result.exported ?? 0} exported, ${result.failed ?? 0} failed.`);
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "GHL synchronization failed.");
    } finally {
      setBusy("");
    }
  }

  const ghl = data.integrations.ghl ?? emptyProvider();
  const crazytel = data.integrations.crazytel ?? emptyProvider();
  const availableFields = [...new Map([...standardFields, ...data.fields.filter((field) => field.available)].map((field) => [field.external_field_id, field])).values()];
  const lastGhlTest = testResults.ghl;
  const lastCrazytelTest = testResults.crazytel;

  return <>
    <section className={styles.securityBanner}><span className={styles.lockIcon}><Check size={16} /></span><div><strong>Company integration settings</strong><p>Secrets are encrypted at rest and never returned to the browser. Browser WebRTC credentials are exposed only to the signed-in agent when a call starts.</p></div><span className={styles.envPill}>SERVER-SIDE</span></section>
    {error ? <p className={`${styles.testResult} ${styles.failure}`} role="alert">{error}</p> : null}
    {notice ? <p className={`${styles.testResult} ${styles.success}`} role="status">{notice}</p> : null}
    {loading ? <p className={styles.noTest}>Loading company settings...</p> : <>
      <div className={styles.sectionHeading}><div><h2>Integrations</h2><p>Each provider is configured for this company. Synchronization is opt-in.</p></div><span>2 PROVIDERS</span></div>
      <div className={styles.integrationGrid}>
        <article className={styles.integrationCard}>
          <header className={styles.cardHeader}><div className={`${styles.serviceIcon} ${styles.ghl}`}>G</div><div className={styles.serviceTitle}><h2>GoHighLevel</h2><p>Optional contact import/export integration</p></div><span className={ghl.connectionStatus === "connected" ? styles.statusReady : styles.statusIncomplete}>{ghl.connectionStatus.replaceAll("_", " ")}</span></header>
          <div className={styles.formFields}>
            <label className={styles.toggleRow}><input type="checkbox" checked={ghl.enabled} onChange={(event) => void save("ghl", event.target.checked)} />Enable GHL for this company</label>
            <label>Private integration key<input type="password" autoComplete="new-password" value={ghlKey} onChange={(event) => setGhlKey(event.target.value)} placeholder={data.hasCredentials.ghl ? "Saved securely; enter to replace" : "Paste private integration key"} /></label>
            <label>Location ID<input value={ghlSettings.locationId} onChange={(event) => setGhlSettings((current) => ({ ...current, locationId: event.target.value }))} placeholder="GHL location ID" /></label>
            <div className={styles.toggleGroup}><label><input type="checkbox" checked={ghlSettings.importEnabled} onChange={(event) => setGhlSettings((current) => ({ ...current, importEnabled: event.target.checked }))} />Allow manual import</label><label><input type="checkbox" checked={ghlSettings.exportEnabled} onChange={(event) => setGhlSettings((current) => ({ ...current, exportEnabled: event.target.checked }))} />Allow manual export</label></div>
            <label className={styles.toggleRow}><input type="checkbox" checked={ghlSettings.exportUpdateExisting} onChange={(event) => setGhlSettings((current) => ({ ...current, exportUpdateExisting: event.target.checked }))} />Allow export to update linked GHL contacts</label>
            <div className={styles.actionRow}><button type="button" className={styles.testButton} onClick={() => void save("ghl", ghl.enabled)} disabled={busy !== ""}><Save size={14} /> Save settings</button><button type="button" className={styles.secondaryButton} onClick={() => void test("ghl")} disabled={busy !== ""}>{busy === "test-ghl" ? "Checking..." : "Test connection"}</button><button type="button" className={styles.secondaryButton} onClick={() => void disconnect("ghl")} disabled={busy !== ""}>Disconnect</button></div>
            {lastGhlTest ? <p className={`${styles.inlineResult} ${lastGhlTest.state === "success" ? styles.success : lastGhlTest.state === "blocked" ? styles.blocked : styles.failure}`}>{lastGhlTest.message}</p> : null}
            {ghl.lastError ? <p className={`${styles.inlineResult} ${styles.failure}`}>{ghl.lastError}</p> : null}
          </div>
          <section className={styles.mappingPanel}><header><div><strong>GHL contact fields</strong><small>Discover fields from this location and map CRM fields.</small></div><button type="button" className={styles.secondaryButton} onClick={() => void refreshFields()} disabled={busy !== ""}><RefreshCw size={14} />{busy === "fields" ? "Refreshing..." : "Refresh fields"}</button></header>
            <div className={styles.mappingRows}>{mappings.map((mapping, index) => <div className={styles.mappingRow} key={`${mapping.internalField}-${index}`}>
              <select aria-label="Internal field" value={mapping.internalField} onChange={(event) => setMappings((current) => current.map((item, row) => row === index ? { ...item, internalField: event.target.value } : item))}><option value="">CRM field</option>{internalFields.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
              <select aria-label="GHL field" value={mapping.externalFieldId} onChange={(event) => setMappings((current) => current.map((item, row) => row === index ? { ...item, externalFieldId: event.target.value } : item))}><option value="">GHL field</option>{availableFields.map((field) => <option key={field.external_field_id} value={field.external_field_id}>{field.name}{field.field_type ? ` · ${field.field_type}` : ""}</option>)}</select>
              <select aria-label="Synchronization direction" value={mapping.syncDirection} onChange={(event) => setMappings((current) => current.map((item, row) => row === index ? { ...item, syncDirection: event.target.value } : item))}><option value="both">Both</option><option value="import">Import</option><option value="export">Export</option><option value="disabled">Disabled</option></select>
              <button type="button" className={styles.iconButton} onClick={() => setMappings((current) => current.filter((_, row) => row !== index))} aria-label="Remove mapping"><Trash2 size={14} /></button>
            </div>)}
            <div className={styles.actionRow}><button type="button" className={styles.secondaryButton} onClick={() => setMappings((current) => [...current, { internalField: "", externalFieldId: "", syncDirection: "both" }])}><Plus size={14} /> Add mapping</button><button type="button" className={styles.testButton} onClick={() => void saveMappings()} disabled={busy !== ""}><Save size={14} />{busy === "mappings" ? "Saving..." : "Save mappings"}</button></div></div>
          </section>
          <div className={styles.syncControls}><div><strong>Manual synchronization</strong><small>Automatic and bidirectional sync remain off by default.</small></div><div className={styles.actionRow}><button type="button" className={styles.secondaryButton} disabled={!ghlSettings.importEnabled || busy !== ""} onClick={() => void sync("import")}>{busy === "import" ? "Importing..." : "Import from GHL"}</button><button type="button" className={styles.secondaryButton} disabled={!ghlSettings.exportEnabled || busy !== ""} onClick={() => void sync("export")}>{busy === "export" ? "Exporting..." : "Export to GHL"}</button></div></div>
          <div className={styles.syncHistory}><strong>Recent synchronization runs</strong>{data.syncRuns.length ? data.syncRuns.map((run) => <article key={run.id}><div><b>{run.operation.replaceAll("_", " ")}</b><span className={styles[run.state] ?? ""}>{run.state}</span></div><small>{new Date(run.started_at).toLocaleString()} · {run.imported_count} imported · {run.exported_count} exported · {run.skipped_count} skipped · {run.failed_count} failed</small></article>) : <p>No synchronization runs recorded.</p>}</div>
        </article>

        <article className={styles.integrationCard}>
          <header className={styles.cardHeader}><div className={`${styles.serviceIcon} ${styles.crazytel}`}>C</div><div className={styles.serviceTitle}><h2>Crazytel</h2><p>Optional Hybrid SIP WebRTC calling provider</p></div><span className={crazytel.connectionStatus === "connected" ? styles.statusReady : styles.statusIncomplete}>{crazytel.connectionStatus.replaceAll("_", " ")}</span></header>
          <div className={styles.formFields}>
            <label className={styles.toggleRow}><input type="checkbox" checked={crazytel.enabled} onChange={(event) => void save("crazytel", event.target.checked)} />Enable Crazytel for this company</label>
            <label>Crazytel API key<input type="password" autoComplete="new-password" value={crazytelCredentials.apiKey} onChange={(event) => setCrazytelCredentials((current) => ({ ...current, apiKey: event.target.value }))} placeholder={data.hasCredentials.crazytel ? "Saved securely; enter to replace" : "API key"} /></label>
            <label>API base URL<input value={crazytelSettings.apiBaseUrl} onChange={(event) => setCrazytelSettings((current) => ({ ...current, apiBaseUrl: event.target.value }))} /></label>
            <label>Hybrid WebRTC SIP URI<input value={crazytelCredentials.webrtcSipUri} onChange={(event) => setCrazytelCredentials((current) => ({ ...current, webrtcSipUri: event.target.value }))} placeholder="sip:user@hybrid.sip.crazytel.net.au" /></label>
            <label>Dedicated WebRTC password<input type="password" autoComplete="new-password" value={crazytelCredentials.webrtcPassword} onChange={(event) => setCrazytelCredentials((current) => ({ ...current, webrtcPassword: event.target.value }))} placeholder={data.hasCredentials.crazytel ? "Saved securely; enter to replace" : "WebRTC password"} /></label>
            <label>WebSocket signaling URL<input value={crazytelSettings.websocketUrl} onChange={(event) => setCrazytelSettings((current) => ({ ...current, websocketUrl: event.target.value }))} /></label>
            <label>Outbound SIP URI template<input value={crazytelSettings.outboundUriTemplate} onChange={(event) => setCrazytelSettings((current) => ({ ...current, outboundUriTemplate: event.target.value }))} placeholder="Use {number}; confirm with Crazytel" /></label>
            <label>Verified caller ID<input value={crazytelSettings.callerId} onChange={(event) => setCrazytelSettings((current) => ({ ...current, callerId: event.target.value }))} /></label>
            <div className={styles.formPair}><label>TURN username<input value={crazytelCredentials.turnUsername} onChange={(event) => setCrazytelCredentials((current) => ({ ...current, turnUsername: event.target.value }))} /></label><label>TURN password<input type="password" autoComplete="new-password" value={crazytelCredentials.turnPassword} onChange={(event) => setCrazytelCredentials((current) => ({ ...current, turnPassword: event.target.value }))} /></label></div>
            <p className={styles.warningText}><CircleHelp size={13} /> WebRTC SIP credentials are sent to the agent browser only when a call starts; prefer distinct trunk credentials per agent.</p>
            <div className={styles.actionRow}><button type="button" className={styles.testButton} onClick={() => void save("crazytel", crazytel.enabled)} disabled={busy !== ""}><Save size={14} /> Save settings</button><button type="button" className={styles.secondaryButton} onClick={() => void test("crazytel")} disabled={busy !== ""}>{busy === "test-crazytel" ? "Checking..." : "Test API key"}</button><button type="button" className={styles.secondaryButton} onClick={() => void disconnect("crazytel")} disabled={busy !== ""}>Disconnect</button></div>
            {lastCrazytelTest ? <p className={`${styles.inlineResult} ${lastCrazytelTest.state === "success" ? styles.success : styles.failure}`}>{lastCrazytelTest.message}</p> : null}
            {crazytel.lastError ? <p className={`${styles.inlineResult} ${styles.failure}`}>{crazytel.lastError}</p> : null}
          </div>
        </article>
      </div>
    </>}
  </>;
}