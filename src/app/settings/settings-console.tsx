"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";

import styles from "@/app/settings/settings.module.css";
import CrazytelTrunkManager from "@/app/settings/crazytel-trunk-manager";

type Provider = "ghl" | "crazytel" | "gemini";
type IntegrationCheck = { name: string; state: "success" | "failure" | "blocked"; message: string };
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

function mappingDefaults(fields: ExternalField[], saved: ConsoleData["mappings"]): Mapping[] {
  const normalizedFields = [...standardFields, ...fields.filter((field) => field.available)];
  const savedByInternal = new Map(saved.map((mapping) => [mapping.internal_field, mapping]));
  const usedExternal = new Set<string>();
  return internalFields.map(([internalField, label]) => {
    const existing = savedByInternal.get(internalField);
    if (existing) {
      usedExternal.add(existing.external_field_id);
      return { internalField, externalFieldId: existing.external_field_id, syncDirection: existing.sync_direction };
    }

    const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    const suggested = normalizedFields.find((field) =>
      !usedExternal.has(field.external_field_id)
      && field.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalizedLabel,
    );
    if (!suggested) return { internalField, externalFieldId: "", syncDirection: "both" };
    usedExternal.add(suggested.external_field_id);
    return { internalField, externalFieldId: suggested.external_field_id, syncDirection: "both" };
  });
}

function GhlFieldPicker({ fields, value, disabledIds, ariaLabel, onChange }: {
  fields: ExternalField[];
  value: string;
  disabledIds: Set<string>;
  ariaLabel: string;
  onChange: (fieldId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedField = fields.find((field) => field.external_field_id === value);
  const filteredFields = fields.filter((field) =>
    `${field.name} ${field.external_field_id} ${field.field_type ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  return <div className={styles.fieldPicker} ref={containerRef}>
    <button
      type="button"
      className={styles.fieldPickerTrigger}
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      onClick={() => setOpen((current) => !current)}
      ref={triggerRef}
    >
      <span>{selectedField
        ? `${selectedField.name}${selectedField.external_field_id.startsWith("standard:") ? " · Standard" : " · Custom"}`
        : value ? `Unavailable field · ${value}` : "Choose a GHL field"}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open ? <div className={styles.fieldPickerMenu} onKeyDown={(event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }}>
      <label className={styles.fieldPickerSearch}>
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          autoFocus
          value={query}
          placeholder="Search GHL fields"
          aria-label="Search GHL fields"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              listRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')?.focus();
            }
          }}
        />
      </label>
      <div className={styles.fieldPickerOptions} role="listbox" aria-label="GoHighLevel fields" ref={listRef}>
        {value ? <button type="button" role="option" aria-selected="false" onClick={() => { onChange(""); setQuery(""); setOpen(false); triggerRef.current?.focus(); }}>Clear selected field</button> : null}
        {filteredFields.map((field) => {
          const selected = field.external_field_id === value;
          return <button
            type="button"
            role="option"
            aria-selected={selected}
            key={field.external_field_id}
            disabled={!selected && disabledIds.has(field.external_field_id)}
            onClick={() => { onChange(field.external_field_id); setQuery(""); setOpen(false); triggerRef.current?.focus(); }}
          >
            <span>{field.name}</span>
            <small>{field.external_field_id.startsWith("standard:") ? "Standard" : "Custom"}{field.field_type ? ` · ${field.field_type}` : ""}</small>
          </button>;
        })}
        {!filteredFields.length ? <p role="status">No matching GHL fields.</p> : null}
      </div>
    </div> : null}
  </div>;
}

export default function SettingsConsole() {
  const [data, setData] = useState<ConsoleData>({ integrations: { ghl: null, crazytel: null }, hasCredentials: {}, fields: [], mappings: [], syncRuns: [] });
  const [ghlKey, setGhlKey] = useState("");
  const [crazytelCredentials, setCrazytelCredentials] = useState({ apiKey: "", webrtcSipUri: "", webrtcPassword: "", turnUsername: "", turnPassword: "" });
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [ghlSettings, setGhlSettings] = useState({ locationId: "", importEnabled: false, exportEnabled: false, exportUpdateExisting: false });
  const [crazytelSettings, setCrazytelSettings] = useState({ apiBaseUrl: "https://api.crazytel.io", websocketUrl: "wss://hybrid.sip.crazytel.net.au:8443", callerId: "", callerIdPassthroughEnabled: false });
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testResults, setTestResults] = useState<Record<string, { state: string; message: string; checks?: IntegrationCheck[] }>>({});
  const [activeDialog, setActiveDialog] = useState<"ghl-connect" | "ghl-fields" | "crazytel-connect" | "gemini-connect" | null>(null);
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
        callerId: String(crazytel.settings.callerId ?? ""),
        callerIdPassthroughEnabled: crazytel.settings.callerIdPassthroughEnabled === true,
      });
      setMappings(mappingDefaults(result.fields, result.mappings));
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
          callerId: String(crazytel.settings.callerId ?? ""),
          callerIdPassthroughEnabled: crazytel.settings.callerIdPassthroughEnabled === true,
        });
        setMappings(mappingDefaults(result.fields, result.mappings));
        setLoading(false);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "Company settings could not be loaded.");
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function save(provider: Provider, enabled: boolean): Promise<boolean> {
    setBusy(`save-${provider}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/integrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(provider === "ghl"
          ? { provider, enabled, credentials: { privateIntegrationKey: ghlKey }, settings: ghlSettings }
          : provider === "crazytel"
            ? { provider, enabled, credentials: crazytelCredentials, settings: crazytelSettings }
            : { provider, enabled, credentials: { apiKey: geminiApiKey } }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Integration settings could not be saved.");
      setNotice(`${provider === "ghl" ? "GoHighLevel" : provider === "crazytel" ? "Crazytel" : "Gemini"} settings saved. Secret values are not returned to this page.`);
      if (provider === "ghl") setGhlKey("");
      else if (provider === "crazytel") setCrazytelCredentials({ apiKey: "", webrtcSipUri: "", webrtcPassword: "", turnUsername: "", turnPassword: "" });
      else setGeminiApiKey("");
      await load();
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Integration settings could not be saved.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function verifyCrazytel() {
    if (!await save("crazytel", crazytel.enabled)) return;
    await test("crazytel");
  }

  async function test(provider: Provider) {
    setBusy(`test-${provider}`);
    setError("");
    try {
      const response = await fetch("/api/admin/integrations/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
      const result = await response.json() as { state?: string; message?: string; checks?: IntegrationCheck[] };
      setTestResults((current) => ({ ...current, [provider]: { state: result.state ?? "failure", message: result.message ?? "Connection check did not complete.", checks: result.checks } }));
      await load();
    } catch {
      setTestResults((current) => ({ ...current, [provider]: { state: "failure", message: "Could not reach the local app endpoint." } }));
    } finally {
      setBusy("");
    }
  }

  async function connectGhl() {
    setBusy("connect-ghl");
    setError("");
    setNotice("");
    setTestResults((current) => ({ ...current, ghl: { state: "checking", message: "Saving settings and connecting to GoHighLevel..." } }));
    try {
      const saveResponse = await fetch("/api/admin/integrations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "ghl", enabled: true, credentials: { privateIntegrationKey: ghlKey }, settings: ghlSettings }),
      });
      const saveResult = await saveResponse.json() as { error?: string };
      if (!saveResponse.ok) throw new Error(saveResult.error ?? "GHL settings could not be saved.");
      setGhlKey("");

      const testResponse = await fetch("/api/admin/integrations/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "ghl" }),
      });
      const testResult = await testResponse.json() as { state?: string; message?: string };
      setTestResults((current) => ({ ...current, ghl: { state: testResult.state ?? "failure", message: testResult.message ?? "GHL connection check failed." } }));
      if (!testResponse.ok || testResult.state !== "success") throw new Error(testResult.message ?? "GHL connection failed. Check the private integration key, location ID, and permissions.");

      const fieldsResponse = await fetch("/api/admin/integrations/ghl/fields", { method: "POST" });
      const fieldsResult = await fieldsResponse.json() as { fields?: ExternalField[]; error?: string };
      if (!fieldsResponse.ok) throw new Error(fieldsResult.error ?? "GHL connected, but its contact fields could not be loaded.");
      await load();
      setNotice(`Connected to GHL. ${fieldsResult.fields?.length ?? 0} contact fields are ready.`);
      setActiveDialog(null);
      setActiveDialog("ghl-fields");
    } catch (connectError) {
      await load();
      setError(connectError instanceof Error ? connectError.message : "GHL could not be connected.");
    } finally {
      setBusy("");
    }
  }

  async function connectCrazytel() {
    if (!await save("crazytel", true)) return;
    await test("crazytel");
    setActiveDialog(null);
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
      setNotice(`${provider === "ghl" ? "GHL" : provider === "crazytel" ? "Crazytel" : "Gemini"} disconnected locally. Revoke the credential with the provider if required.`);
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
  const discoveredCustomFields = data.fields.filter((field) => field.available && !field.external_field_id.startsWith("standard:"));
  const lastGhlTest = testResults.ghl;
  const lastCrazytelTest = testResults.crazytel;

  return <>
    <section className={styles.securityBanner}><span className={styles.lockIcon}><Check size={16} /></span><div><strong>Company integration settings</strong><p>Secrets are encrypted at rest and never returned to the browser. Browser WebRTC credentials are exposed only to the signed-in agent when a call starts.</p></div><span className={styles.envPill}>SERVER-SIDE</span></section>
    {error ? <p className={`${styles.testResult} ${styles.failure}`} role="alert">{error}</p> : null}
    {notice ? <p className={`${styles.testResult} ${styles.success}`} role="status">{notice}</p> : null}
    {loading ? <p className={styles.noTest}>Loading company settings...</p> : <>
      <div className={styles.sectionHeading}><div><h2>Integrations</h2><p>Each provider is configured for this company. Synchronization is opt-in.</p></div><span>3 PROVIDERS</span></div>
      <div className={styles.integrationGrid}>
        <article className={styles.integrationCard}>
          <header className={styles.cardHeader}><div className={`${styles.serviceIcon} ${styles.ghl}`}>G</div><div className={styles.serviceTitle}><h2>GoHighLevel</h2><p>Optional contact import/export integration</p></div><span className={ghl.connectionStatus === "connected" ? styles.statusReady : styles.statusIncomplete}>{ghl.connectionStatus.replaceAll("_", " ")}</span></header>
          <div className={styles.providerSummary}>
            <p>{ghl.connectionStatus === "connected" ? "GoHighLevel is connected for this company." : "Connect a GoHighLevel location to configure contact sync."}</p>
            {ghl.lastError ? <p className={`${styles.inlineResult} ${styles.failure}`}>{ghl.lastError}</p> : null}
            {lastGhlTest ? <p className={`${styles.inlineResult} ${lastGhlTest.state === "success" ? styles.success : lastGhlTest.state === "blocked" ? styles.blocked : styles.failure}`}>{lastGhlTest.message}</p> : null}
            <div className={styles.actionRow}>
              {ghl.connectionStatus === "connected"
                ? <button type="button" className={styles.testButton} onClick={() => setActiveDialog("ghl-fields")}><Save size={14} />Configure Fields</button>
                : <button type="button" className={styles.testButton} onClick={() => setActiveDialog("ghl-connect")}><RefreshCw size={14} />Connect GoHighLevel</button>}
              {ghl.enabled ? <button type="button" className={styles.secondaryButton} onClick={() => void disconnect("ghl")} disabled={busy !== ""}>Disconnect</button> : null}
            </div>
          </div>
          {activeDialog === "ghl-connect" ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveDialog(null); }}>
            <section className={styles.settingsDialog} role="dialog" aria-modal="true" aria-labelledby="ghl-connect-title">
              <header><div><span className={styles.serviceIcon + " " + styles.ghl}>G</span><div><h2 id="ghl-connect-title">Connect GoHighLevel</h2><p>Enter your private key and location details.</p></div></div><button type="button" onClick={() => setActiveDialog(null)} aria-label="Close">×</button></header>
              <div className={styles.formFields}>
                <label>Private integration key<input type="password" autoComplete="new-password" value={ghlKey} onChange={(event) => setGhlKey(event.target.value)} placeholder={data.hasCredentials.ghl ? "Saved securely; enter to replace" : "Paste private integration key"} /></label>
                <label>Location ID<input value={ghlSettings.locationId} onChange={(event) => setGhlSettings((current) => ({ ...current, locationId: event.target.value }))} placeholder="GHL location ID" /></label>
                <div className={styles.toggleGroup}><label><input type="checkbox" checked={ghlSettings.importEnabled} onChange={(event) => setGhlSettings((current) => ({ ...current, importEnabled: event.target.checked }))} />Allow manual import</label><label><input type="checkbox" checked={ghlSettings.exportEnabled} onChange={(event) => setGhlSettings((current) => ({ ...current, exportEnabled: event.target.checked }))} />Allow manual export</label></div>
                <label className={styles.toggleRow}><input type="checkbox" checked={ghlSettings.exportUpdateExisting} onChange={(event) => setGhlSettings((current) => ({ ...current, exportUpdateExisting: event.target.checked }))} />Allow export to update linked GHL contacts</label>
                <div className={styles.actionRow}><button type="button" className={styles.testButton} onClick={() => void connectGhl()} disabled={busy !== "" || !ghlSettings.locationId.trim() || (!ghlKey.trim() && !data.hasCredentials.ghl)}><RefreshCw size={14} />{busy === "connect-ghl" ? "Connecting..." : "Connect GoHighLevel"}</button><button type="button" className={styles.secondaryButton} onClick={() => void save("ghl", true)} disabled={busy !== ""}><Save size={14} />Save settings</button><button type="button" className={styles.secondaryButton} onClick={() => void test("ghl")} disabled={busy !== ""}>{busy === "test-ghl" ? "Checking..." : "Test connection"}</button></div>
              </div>
            </section>
          </div> : null}
          {activeDialog === "ghl-fields" ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveDialog(null); }}>
          <section className={`${styles.settingsDialog} ${styles.settingsDialogWide}`} role="dialog" aria-modal="true" aria-labelledby="ghl-fields-title">
          <header><div><span className={styles.serviceIcon + " " + styles.ghl}>G</span><div><h2 id="ghl-fields-title">Configure GoHighLevel fields</h2><p>Map fields and manage manual synchronization.</p></div></div><button type="button" onClick={() => setActiveDialog(null)} aria-label="Close">×</button></header>
          <div className={styles.settingsDialogBody}>
          <section className={styles.mappingPanel}>
            <header>
              <div><strong>Connect your CRM fields to GoHighLevel</strong><small>Choose one CRM field on the left and the matching GHL field on the right. GHL fields load after connecting.</small></div>
              <button type="button" className={styles.secondaryButton} onClick={() => void refreshFields()} disabled={busy !== ""}><RefreshCw size={14} />{busy === "fields" ? "Loading GHL fields..." : "Refresh GHL fields"}</button>
            </header>
            <div className={styles.mappingColumns} aria-hidden="true">
              <div><strong>Your CRM fields</strong><small>{internalFields.length} available fields</small></div>
              <span />
              <div><strong>GoHighLevel fields</strong><small>{discoveredCustomFields.length} custom · {standardFields.length} standard</small></div>
              <span>Sync direction</span>
            </div>
            {!data.fields.some((field) => field.available) && !ghl.connectionStatus.includes("connected")
              ? <p className={styles.mappingHint}>Connect GoHighLevel above to load your location&apos;s custom fields.</p>
              : !discoveredCustomFields.length
                ? <p className={styles.mappingHint}>No GHL custom fields loaded yet. Connect or refresh fields to see the fields from your location.</p>
                : null}
            <div className={styles.mappingRows}>{mappings.map((mapping, index) => {
              const usedCrmFields = new Set(mappings.flatMap((item, row) => row !== index && item.internalField ? [item.internalField] : []));
              const usedGhlFields = new Set(mappings.flatMap((item, row) => row !== index && item.externalFieldId ? [item.externalFieldId] : []));
              return <div className={styles.mappingRow} key={`${mapping.internalField || "new"}-${index}`}>
                <select aria-label={`CRM field for mapping ${index + 1}`} value={mapping.internalField} onChange={(event) => setMappings((current) => current.map((item, row) => row === index ? { ...item, internalField: event.target.value } : item))}>
                  <option value="">Choose a CRM field</option>
                  {internalFields.map(([id, label]) => <option key={id} value={id} disabled={usedCrmFields.has(id)}>{label}</option>)}
                </select>
                <span className={styles.mappingArrow} aria-hidden="true"><ArrowRight size={16} /></span>
                <GhlFieldPicker
                  ariaLabel={`GoHighLevel field for mapping ${index + 1}`}
                  fields={availableFields}
                  value={mapping.externalFieldId}
                  disabledIds={usedGhlFields}
                  onChange={(externalFieldId) => setMappings((current) => current.map((item, row) => row === index ? { ...item, externalFieldId } : item))}
                />
                <select aria-label={`Sync direction for mapping ${index + 1}`} value={mapping.syncDirection} onChange={(event) => setMappings((current) => current.map((item, row) => row === index ? { ...item, syncDirection: event.target.value } : item))}>
                  <option value="both">Both ways</option><option value="import">GHL → CRM</option><option value="export">CRM → GHL</option><option value="disabled">Disabled</option>
                </select>
                <button type="button" className={styles.removeMapping} onClick={() => setMappings((current) => current.filter((_, row) => row !== index))} aria-label={`Remove mapping ${index + 1}`}><Trash2 size={14} /></button>
              </div>;
            })}</div>
            <div className={styles.mappingFooter}>
              <button type="button" className={styles.secondaryButton} onClick={() => setMappings((current) => [...current, { internalField: "", externalFieldId: "", syncDirection: "both" }])} disabled={busy !== "" || mappings.length >= 50}><Plus size={14} />Add field mapping</button>
              <button type="button" className={styles.testButton} onClick={() => void saveMappings()} disabled={busy !== ""}><Save size={14} />{busy === "mappings" ? "Saving mappings..." : "Save mappings"}</button>
            </div>
          </section>
          <div className={styles.syncControls}><div><strong>Manual synchronization</strong><small>Automatic and bidirectional sync remain off by default.</small></div><div className={styles.actionRow}><button type="button" className={styles.secondaryButton} disabled={!ghlSettings.importEnabled || busy !== ""} onClick={() => void sync("import")}>{busy === "import" ? "Importing..." : "Import from GHL"}</button><button type="button" className={styles.secondaryButton} disabled={!ghlSettings.exportEnabled || busy !== ""} onClick={() => void sync("export")}>{busy === "export" ? "Exporting..." : "Export to GHL"}</button></div></div>
          <div className={styles.syncHistory}><strong>Recent synchronization runs</strong>{data.syncRuns.length ? data.syncRuns.map((run) => <article key={run.id}><div><b>{run.operation.replaceAll("_", " ")}</b><span className={styles[run.state] ?? ""}>{run.state}</span></div><small>{new Date(run.started_at).toLocaleString()} · {run.imported_count} imported · {run.exported_count} exported · {run.skipped_count} skipped · {run.failed_count} failed</small></article>) : <p>No synchronization runs recorded.</p>}</div>
          </div>
          </section>
          </div> : null}
        </article>

        <article className={styles.integrationCard}>
          <header className={styles.cardHeader}><div className={`${styles.serviceIcon} ${styles.crazytel}`}>C</div><div className={styles.serviceTitle}><h2>Crazytel</h2><p>Optional Hybrid SIP WebRTC calling provider</p></div><span className={crazytel.connectionStatus === "connected" ? styles.statusReady : styles.statusIncomplete}>{crazytel.connectionStatus === "connected" ? "API key valid" : crazytel.connectionStatus.replaceAll("_", " ")}</span></header>
          <div className={styles.providerSummary}>
            <p>{crazytel.connectionStatus === "connected" ? "Crazytel account connected. Add each Hybrid trunk below to set up browser calling." : "Add your Crazytel API key to load trunks and verified caller IDs."}</p>
            {crazytel.lastError ? <p className={`${styles.inlineResult} ${styles.failure}`}>{crazytel.lastError}</p> : null}
            {lastCrazytelTest ? <div className={`${styles.inlineResult} ${lastCrazytelTest.state === "success" ? styles.success : styles.failure}`}><p>{lastCrazytelTest.message}</p>{lastCrazytelTest.checks?.map((check) => <p key={check.name}>{check.state === "success" ? "✓" : "×"} {check.name}: {check.message}</p>)}</div> : null}
            <div className={styles.actionRow}>
              <button type="button" className={styles.secondaryButton} onClick={() => setActiveDialog("crazytel-connect")}><Save size={14} />{data.hasCredentials.crazytel ? "Crazytel API settings" : "Connect Crazytel"}</button>
              {data.hasCredentials.crazytel ? <button type="button" className={styles.secondaryButton} onClick={() => void verifyCrazytel()} disabled={busy !== ""}><RefreshCw size={14} />{busy === "test-crazytel" ? "Checking..." : "Verify connection"}</button> : null}
              {crazytel.enabled ? <button type="button" className={styles.secondaryButton} onClick={() => void disconnect("crazytel")} disabled={busy !== ""}>Disconnect</button> : null}
            </div>
          </div>
          {crazytel.enabled && data.hasCredentials.crazytel ? <>
            <CrazytelTrunkManager />
          </> : null}
          {activeDialog === "crazytel-connect" ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveDialog(null); }}>
            <section className={styles.settingsDialog} role="dialog" aria-modal="true" aria-labelledby="crazytel-connect-title">
              <header><div><span className={styles.serviceIcon + " " + styles.crazytel}>C</span><div><h2 id="crazytel-connect-title">Connect your Crazytel account</h2><p>Add the API key once. WebRTC trunk details are entered separately below.</p></div></div><button type="button" onClick={() => setActiveDialog(null)} aria-label="Close">×</button></header>
              <div className={styles.formFields}>
                <label>Crazytel API key<input type="password" autoComplete="new-password" value={crazytelCredentials.apiKey} onChange={(event) => setCrazytelCredentials((current) => ({ ...current, apiKey: event.target.value }))} placeholder={data.hasCredentials.crazytel ? "Saved securely; leave blank to keep existing" : "Paste API key"} /></label>
                <p className={styles.mappingHint}>Find this in Crazytel MyAccount. This key loads your account&apos;s SIP trunks and verified caller IDs. It is not your SIP or WebRTC password.</p>
                <p className={styles.mappingHint}>Next, under <strong>Hybrid SIP trunks and agent assignments</strong>, click <strong>Add trunk manually</strong>. You will enter the WebRTC SIP address, its separate one-time WebRTC password, verified caller ID, and Crazytel&apos;s PSTN dial format.</p>
                <div className={styles.actionRow}><button type="button" className={styles.testButton} onClick={() => void connectCrazytel()} disabled={busy !== ""}>{busy === "save-crazytel" || busy === "test-crazytel" ? "Connecting..." : data.hasCredentials.crazytel ? "Save & verify" : "Connect Crazytel"}</button><button type="button" className={styles.secondaryButton} onClick={() => void save("crazytel", true)} disabled={busy !== ""}><Save size={14} />Save without testing</button></div>
              </div>
            </section>
          </div> : null}
        </article>
        <article className={styles.integrationCard}>
          <header className={styles.cardHeader}><div className={`${styles.serviceIcon} ${styles.gemini}`}>G</div><div className={styles.serviceTitle}><h2>Gemini Voice Alerts</h2><p>Company-owned Gemini TTS credentials</p></div><span className={data.hasCredentials.gemini ? styles.statusReady : styles.statusIncomplete}>{data.hasCredentials.gemini ? "API key saved" : "Not configured"}</span></header>
          <div className={styles.providerSummary}>
            <p>{data.hasCredentials.gemini ? "This company’s Gemini key is encrypted at rest and used only to generate its agents’ Voice Alerts." : "Add a Gemini API key to use Voice Alert announcements for this company’s agents."}</p>
            <p className={styles.mappingHint}>Keys are stored encrypted and never returned to the browser. Each company manages its own key.</p>
            <div className={styles.actionRow}>
              <button type="button" className={styles.secondaryButton} onClick={() => setActiveDialog("gemini-connect")}><Save size={14} />{data.hasCredentials.gemini ? "Update Gemini API key" : "Add Gemini API key"}</button>
              {data.hasCredentials.gemini ? <button type="button" className={styles.secondaryButton} onClick={() => void disconnect("gemini")} disabled={busy !== ""}>Remove key</button> : null}
            </div>
          </div>
          {activeDialog === "gemini-connect" ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveDialog(null); }}>
            <section className={styles.settingsDialog} role="dialog" aria-modal="true" aria-labelledby="gemini-connect-title">
              <header><div><span className={`${styles.serviceIcon} ${styles.gemini}`}>G</span><div><h2 id="gemini-connect-title">Configure Gemini Voice Alerts</h2><p>Enter the Gemini API key owned by this company.</p></div></div><button type="button" onClick={() => setActiveDialog(null)} aria-label="Close">×</button></header>
              <div className={styles.formFields}>
                <label>Gemini API key<input type="password" autoComplete="new-password" value={geminiApiKey} onChange={(event) => setGeminiApiKey(event.target.value)} placeholder={data.hasCredentials.gemini ? "Saved securely; enter a new key to replace" : "Paste Gemini API key"} /></label>
                <p className={styles.mappingHint}>The key is encrypted before it is saved. Announcement text is sent to Google Gemini when generating voice audio.</p>
                <div className={styles.actionRow}><button type="button" className={styles.testButton} onClick={() => void save("gemini", true)} disabled={busy !== "" || !geminiApiKey.trim()}><Save size={14} />{busy === "save-gemini" ? "Saving..." : "Save API key"}</button></div>
              </div>
            </section>
          </div> : null}
        </article>
      </div>
    </>}
  </>;
}