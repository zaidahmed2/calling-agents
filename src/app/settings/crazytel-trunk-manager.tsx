"use client";

import { useEffect, useState } from "react";
import { Check, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Registerer, UserAgent } from "sip.js";

import styles from "@/app/settings/settings.module.css";
import { normalizeCrazytelSipUsername } from "@/lib/crazytel-utils";

type Trunk = {
  id: string;
  username: string;
  enabled: boolean;
  callerIdNumber: string | null;
  description: string | null;
  manual?: boolean;
};
type Agent = {
  id: string;
  name: string;
  email: string;
  callerId: string | null;
  trunkId: string | null;
  trunkUsername: string | null;
  trunkCallerId: string | null;
  outboundUriTemplate?: string | null;
};
type Data = { callerIds: Array<{ id: string; number: string; nickname: string | null }>; trunks: Trunk[]; agents: Agent[] };

async function fetchCrazytelTrunks(): Promise<Data> {
  const response = await fetch("/api/admin/integrations/crazytel/caller-ids", { cache: "no-store" });
  const result = await response.json() as Data & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Crazytel trunks could not be loaded.");
  return { callerIds: result.callerIds ?? [], trunks: result.trunks ?? [], agents: result.agents ?? [] };
}

function samePhoneNumber(left: string, right: string) {
  const leftDigits = left.replace(/\D/g, "");
  return leftDigits.length > 0 && leftDigits === right.replace(/\D/g, "");
}

export default function CrazytelTrunkManager() {
  const [data, setData] = useState<Data>({ callerIds: [], trunks: [], agents: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedTrunkId, setSelectedTrunkId] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [manualTrunkId, setManualTrunkId] = useState("");
  const [manualUsername, setManualUsername] = useState("");
  const [manualCallerId, setManualCallerId] = useState("");
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [testing, setTesting] = useState(false);
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const result = await fetchCrazytelTrunks();
      setError("");
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Crazytel trunks could not be loaded.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchCrazytelTrunks()
      .then((result) => {
        if (!active) return;
        setError("");
        setData(result);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Crazytel trunks could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const selectedTrunk = manualMode && selectedTrunkId
    ? {
      id: manualTrunkId,
      username: normalizeCrazytelSipUsername(manualUsername) ?? "",
      enabled: true,
      callerIdNumber: manualCallerId.trim() || null,
      description: "Manually added Hybrid trunk",
      manual: true,
    }
    : data.trunks.find((trunk) => trunk.id === selectedTrunkId);
  const currentAgents = data.agents.filter((agent) => agent.trunkId === selectedTrunkId);
  const assignedCallerId = selectedTrunk?.callerIdNumber;
  const callerIdVerified = Boolean(assignedCallerId && data.callerIds.some((callerId) => samePhoneNumber(callerId.number, assignedCallerId)));
  function openAssignment(trunk: Trunk) {
    setManualMode(Boolean(trunk.manual));
    setSelectedTrunkId(trunk.id);
    setManualTrunkId(trunk.id);
    setManualUsername(trunk.manual ? trunk.username : "");
    setManualCallerId(trunk.manual ? trunk.callerIdNumber ?? "" : "");
    setAgentIds(data.agents.filter((agent) => agent.trunkId === trunk.id).map((agent) => agent.id));
    setPassword("");
    setVerified(data.agents.some((agent) => agent.trunkId === trunk.id));
    setError("");
    setNotice("");
  }

  function openManualTrunk() {
    setManualMode(true);
    const id = crypto.randomUUID();
    setSelectedTrunkId(id);
    setManualTrunkId(id);
    setManualUsername("");
    setManualCallerId("");
    setAgentIds([]);
    setPassword("");
    setVerified(false);
    setError("");
    setNotice("");
  }

  async function testRegistration() {
    if (!selectedTrunk?.username || !password || !callerIdVerified) return;
    setTesting(true);
    setVerified(false);
    setError("");
    setNotice("");
    const uri = UserAgent.makeURI(`sip:${selectedTrunk.username}@hybrid.sip.crazytel.net.au`);
    if (!uri) {
      setError("Crazytel returned an invalid SIP username.");
      setTesting(false);
      return;
    }
    const userAgent = new UserAgent({
      uri,
      authorizationUsername: selectedTrunk.username,
      authorizationPassword: password,
      transportOptions: { server: "wss://hybrid.sip.crazytel.net.au:8443" },
      logBuiltinEnabled: false,
      logConfiguration: false,
      userAgentString: "Terraverse CRM Hybrid trunk verification",
    });
    const registerer = new Registerer(userAgent);
    let timeout: number | undefined;
    try {
      await Promise.race([
        (async () => { await userAgent.start(); await registerer.register(); })(),
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => reject(new Error("SIP registration timed out after 15 seconds.")), 15_000);
        }),
      ]);
      setVerified(true);
      setNotice("WebRTC registration succeeded. No call was placed.");
    } catch (testError) {
      setError(testError instanceof Error ? `WebRTC registration failed: ${testError.message}` : "WebRTC registration failed.");
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      await registerer.unregister().catch(() => undefined);
      await userAgent.stop().catch(() => undefined);
      setTesting(false);
    }
  }

  async function assignTrunk() {
    if (!selectedTrunk?.username || !agentIds.length || !verified || !callerIdVerified) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/integrations/crazytel/assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentIds,
          trunkId: selectedTrunk.id,
          username: selectedTrunk.username,
          callerId: selectedTrunk.callerIdNumber,
          manual: Boolean(selectedTrunk.manual),
          webrtcPassword: password,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Hybrid trunk could not be assigned.");
      setNotice(`Hybrid trunk assigned to ${agentIds.length} ${agentIds.length === 1 ? "agent" : "agents"}.`);
      setSelectedTrunkId("");
      setAgentIds([]);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Hybrid trunk could not be assigned.");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.trunkManager}>
    <header className={styles.trunkManagerHeader}>
      <div>
        <strong>Hybrid SIP trunks and agent assignments</strong>
        <small>Enter your Crazytel API key once. Then add each Hybrid trunk using its WebRTC username and one-time password.</small>
      </div>
      <div className={styles.actionRow}>
        <button type="button" className={styles.secondaryButton} onClick={openManualTrunk}>
          <Plus size={14} />Add trunk manually
        </button>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={refreshing}>
          <RefreshCw size={14} />{refreshing ? "Refreshing..." : "Refresh trunks"}
        </button>
      </div>
    </header>
    {error ? <p className={styles.inlineResult + " " + styles.failure} role="alert">{error}</p> : null}
    {notice ? <p className={styles.inlineResult + " " + styles.success} role="status">{notice}</p> : null}
    {loading ? <p className={styles.mappingHint}>Loading Crazytel trunks...</p> : data.trunks.length ? <div className={styles.trunkList}>
      {data.trunks.map((trunk) => {
        const assigned = data.agents.filter((agent) => agent.trunkId === trunk.id);
        const cliVerified = Boolean(trunk.callerIdNumber && data.callerIds.some((callerId) => samePhoneNumber(callerId.number, trunk.callerIdNumber ?? "")));
        return <article className={styles.trunkRow} key={trunk.id}>
          <div className={styles.trunkIdentity}>
            <strong>{trunk.description || trunk.username}</strong>
            <small>{trunk.username}{trunk.callerIdNumber ? ` · Caller ID ${trunk.callerIdNumber}` : " · No caller ID configured"}</small>
          </div>
          <span className={trunk.enabled ? styles.verifiedPill : styles.trunkDisabled}>{trunk.manual ? "Manual" : trunk.enabled ? "Enabled" : "Disabled"}</span>
          <span className={cliVerified ? styles.verifiedPill : styles.trunkDisabled}>{!trunk.callerIdNumber ? "No CLI" : cliVerified ? "CLI verified" : "CLI not verified"}</span>
          <div className={styles.trunkAssignment}>
            <small>{assigned.length === 1 ? "Assigned agent" : "Assigned agents"}</small>
            <strong title={assigned.map((agent) => agent.name).join(", ")}>{assigned.length ? assigned.map((agent) => agent.name).join(", ") : "Not assigned"}</strong>
          </div>
          <button type="button" className={styles.assignCallerId} onClick={() => openAssignment(trunk)} disabled={!trunk.enabled || !trunk.callerIdNumber || !cliVerified}>
            <Plus size={13} />{assigned.length ? "Configure / change" : trunk.manual ? "Configure" : "Verify & assign"}
          </button>
        </article>;
      })}
    </div> : <p className={styles.mappingHint}>No SIP trunks were returned. You can refresh the API list or add a Hybrid trunk manually.</p>}
    {selectedTrunk ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && !testing && !saving) { setSelectedTrunkId(""); setManualMode(false); } }}>
      <section className={styles.settingsDialog} role="dialog" aria-modal="true" aria-labelledby="crazytel-trunk-dialog-title">
        <header>
          <div><span className={`${styles.serviceIcon} ${styles.crazytel}`}><ShieldCheck size={17} /></span><div><h2 id="crazytel-trunk-dialog-title">{manualMode ? "Add and assign Hybrid trunk" : "Verify and assign Hybrid trunk"}</h2><p>{selectedTrunk.username || "Enter the trunk SIP username"} · {selectedTrunk.callerIdNumber ?? "Caller ID required"}</p></div></div>
          <button type="button" onClick={() => { setSelectedTrunkId(""); setManualMode(false); }} disabled={testing || saving} aria-label="Close">×</button>
        </header>
        <div className={styles.formFields}>
          {manualMode ? <>
            <label>Username / SIP address <span>(Crazytel → WebRTC softphone)</span>
              <input autoComplete="off" value={manualUsername} onChange={(event) => { setManualUsername(event.target.value); setVerified(false); }} placeholder="Paste sip:username@hybrid.sip.crazytel.net.au" />
            </label>
            <p className={styles.mappingHint}>Copy “Username / SIP address” from the WebRTC softphone section. SIP proxy and WSS are already set automatically.</p>
            <label>Verified caller ID on this trunk
              <input inputMode="tel" autoComplete="off" value={manualCallerId} onChange={(event) => { setManualCallerId(event.target.value); setVerified(false); }} placeholder="Number configured on this trunk" />
            </label>
            {manualCallerId ? <p className={callerIdVerified ? styles.inlineResult + " " + styles.success : styles.warningText}>{callerIdVerified ? "Caller ID is verified on the Crazytel account." : "Number not found in the verified caller ID list. Verify it in MyAccount and refresh."}</p> : null}
          </> : null}
          <div className={styles.agentSelection}>
            <strong>Assign to agents <small>Select one or more agents for this trunk.</small></strong>
            {data.agents.map((agent) => {
              const checked = agentIds.includes(agent.id);
              const movingFrom = agent.trunkId && agent.trunkId !== selectedTrunk.id;
              return <label key={agent.id} className={styles.agentOption}>
                <input type="checkbox" checked={checked} onChange={(event) => {
                  setAgentIds((current) => event.target.checked
                    ? [...current, agent.id]
                    : current.filter((id) => id !== agent.id));
                }} />
                <span><strong>{agent.name}</strong><small>{agent.email}{movingFrom ? ` · currently assigned to ${agent.trunkUsername}` : ""}</small></span>
              </label>;
            })}
            {!data.agents.length ? <p className={styles.mappingHint}>Add agents to this company before assigning a trunk.</p> : null}
          </div>
          {currentAgents.length ? <p className={styles.mappingHint}>Currently assigned to {currentAgents.map((agent) => agent.name).join(", ")}. Select the complete set of agents that should use this trunk.</p> : null}
          {currentAgents.length ? <p className={styles.mappingHint}>This trunk is already verified. Its saved WebRTC password will be reused for all selected agents; assignment changes will not ask for it again.</p> : <>
            <label>WebRTC password <span>(one-time password under “WebRTC softphone”)</span>
              <input type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setVerified(false); }} placeholder="Paste WebRTC password" />
            </label>
            <p className={styles.mappingHint}>Do not use the desk-phone SIP password here. It is different from the WebRTC password and is not used for browser calling.</p>
          </>}
          <p className={styles.mappingHint}>All selected agents will use this same WebRTC login and caller ID. Confirm your Crazytel account supports the required simultaneous registrations and calls.</p>
          <p className={styles.mappingHint}>Phone-number dialing is configured automatically using Crazytel&apos;s confirmed format. When an agent calls a contact, the app converts the contact number (for example, 0422 436 270 → 61422436270) and builds the SIP address. WebRTC server: <code>wss://hybrid.sip.crazytel.net.au:8443</code>. Registration checks login only; it does not place a call.</p>
          {error ? <p className={styles.inlineResult + " " + styles.failure} role="alert">{error}</p> : null}
          {notice ? <p className={styles.inlineResult + " " + styles.success} role="status">{notice}</p> : null}
          <div className={styles.actionRow}>
            {currentAgents.length ? <span className={styles.verifiedPill}>Saved login verified</span> : <button type="button" className={styles.secondaryButton} onClick={() => void testRegistration()} disabled={testing || saving || !selectedTrunk.enabled || !selectedTrunk.username || !selectedTrunk.callerIdNumber || !password || !agentIds.length || !callerIdVerified}>
              <RefreshCw size={14} />{testing ? "Testing registration..." : verified ? "Registration verified" : "Test WebRTC registration"}
            </button>}
            <button type="button" className={styles.testButton} onClick={() => void assignTrunk()} disabled={saving || testing || !verified || !agentIds.length || !callerIdVerified}>
              <Check size={14} />{saving ? "Assigning..." : `Assign to ${agentIds.length || "agents"}`}
            </button>
          </div>
        </div>
      </section>
    </div> : null}
  </section>;
}
