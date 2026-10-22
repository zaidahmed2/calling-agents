"use client";

import { useEffect, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { Registerer, UserAgent } from "sip.js";

import styles from "@/app/agents/[id]/agent-detail.module.css";

type Trunk = { id: string; username: string; enabled: boolean; caller_id_number: string | null; description: string | null };
type VerifiedCallerId = { id: string; number: string; nickname: string | null; domain: string | null };
type Assignment = { trunks?: Trunk[]; selectedTrunkId?: string | null; selectedUsername?: string | null; selectedCallerId?: string | null; passwordSaved?: boolean; error?: string };

export default function AgentCrazytelAssignment({ agentId }: { agentId: string }) {
  const [trunks, setTrunks] = useState<Trunk[]>([]);
  const [trunkId, setTrunkId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [callerIds, setCallerIds] = useState<VerifiedCallerId[]>([]);
  const [callerId, setCallerId] = useState("");
  const [callerIdsLoading, setCallerIdsLoading] = useState(true);
  const [callerIdError, setCallerIdError] = useState("");
  const [savingCallerId, setSavingCallerId] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [registrationVerified, setRegistrationVerified] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/crazytel`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as Assignment;
        if (!response.ok) throw new Error(result.error ?? "Crazytel trunks could not be loaded.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        const available = result.trunks ?? [];
        setTrunks(available);
        setTrunkId(result.selectedTrunkId ?? "");
        setUsername(result.selectedUsername ?? "");
        setPasswordSaved(Boolean(result.passwordSaved));
        setCallerId(result.selectedCallerId ?? "");
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Crazytel settings could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    void fetch("/api/admin/integrations/crazytel/caller-ids", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { callerIds?: VerifiedCallerId[]; agents?: Array<{ id: string; callerId: string | null }>; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Verified caller IDs could not be loaded.");
        return result;
      })
      .then((result) => {
        if (!active) return;
        setCallerIds(result.callerIds ?? []);
        setCallerId(result.agents?.find((agent) => agent.id === agentId)?.callerId ?? "");
      })
      .catch((loadError: unknown) => {
        if (active) setCallerIdError(loadError instanceof Error ? loadError.message : "Verified caller IDs could not be loaded.");
      })
      .finally(() => { if (active) setCallerIdsLoading(false); });
    return () => { active = false; };
  }, [agentId]);

  async function saveCallerId() {
    setSavingCallerId(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/integrations/crazytel/caller-ids", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: agentId, callerId: callerId || null }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Caller-ID assignment could not be saved.");
      setNotice(callerId ? "Caller ID assigned. It will be used for calls after Crazytel enables Caller ID Passthrough." : "Caller-ID assignment removed.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Caller-ID assignment could not be saved.");
    } finally {
      setSavingCallerId(false);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/crazytel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trunkId, username, webrtcPassword: password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Agent trunk assignment could not be saved.");
      setPassword("");
      setPasswordSaved(true);
      setRegistrationVerified(false);
      setNotice("Dedicated Crazytel trunk assigned to this agent.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Agent trunk assignment could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function testRegistration() {
    if (!selected || !password) return;
    setTesting(true);
    setRegistrationVerified(false);
    setError("");
    setNotice("");
    const uri = UserAgent.makeURI(`sip:${selected.username}@hybrid.sip.crazytel.net.au`);
    if (!uri) {
      setError("Crazytel trunk returned an invalid SIP username.");
      setTesting(false);
      return;
    }
    const userAgent = new UserAgent({
      uri,
      authorizationUsername: selected.username,
      authorizationPassword: password,
      transportOptions: { server: "wss://hybrid.sip.crazytel.net.au:8443" },
      logBuiltinEnabled: false,
      logConfiguration: false,
      userAgentString: "Terraverse CRM WebRTC verification",
    });
    const registerer = new Registerer(userAgent);
    let timeout: number | undefined;
    try {
      await Promise.race([
        (async () => { await userAgent.start(); await registerer.register(); })(),
        new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error("SIP registration timed out after 15 seconds.")), 15_000); }),
      ]);
      setRegistrationVerified(true);
      setNotice("WebRTC SIP registration succeeded. No call was placed.");
    } catch (testError) {
      setError(testError instanceof Error ? `WebRTC SIP registration failed: ${testError.message}` : "WebRTC SIP registration failed.");
    } finally {
      if (timeout !== undefined) window.clearTimeout(timeout);
      await registerer.unregister().catch(() => undefined);
      await userAgent.stop().catch(() => undefined);
      setTesting(false);
    }
  }

  const selected = trunks.find((trunk) => trunk.id === trunkId);

  return <section className={styles.visibilityPanel}>
    <header><span className={styles.visibilityIcon}><ShieldCheck size={16} /></span><div><span className={styles.sectionEyebrow}>CRAZyTEL WEBRTC</span><h2>Agent calling trunk</h2><p>Assign an enabled SIP trunk and its dedicated WebRTC password.</p></div></header>
    {loading ? <p className={styles.visibilityMessage}>Loading Crazytel trunks...</p> : <>
      <div className={styles.visibilityFields}>
        <label className={styles.callingAssignmentField}>Crazytel SIP trunk
          <select value={trunkId} onChange={(event) => {
            const selectedTrunk = trunks.find((trunk) => trunk.id === event.target.value);
            setTrunkId(event.target.value);
            setUsername(selectedTrunk?.username ?? "");
            setRegistrationVerified(false);
          }}>
            <option value="">Select an enabled trunk</option>
            {trunks.map((trunk) => <option key={trunk.id} value={trunk.id}>{trunk.username}{trunk.caller_id_number ? ` · ${trunk.caller_id_number}` : ""}{trunk.description ? ` · ${trunk.description}` : ""}</option>)}
          </select>
        </label>
        <label className={styles.callingAssignmentField}>Dedicated WebRTC password
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setRegistrationVerified(false); }} placeholder={passwordSaved ? "Saved securely; enter to replace" : "WebRTC password for this trunk"} />
        </label>
      </div>
      {selected ? <p className={styles.visibilityMessage}>SIP identity: <code>sip:{selected.username}@hybrid.sip.crazytel.net.au</code></p> : null}
      <div className={styles.callingAssignmentField}>
        <label htmlFor="crazytel-caller-id">Verified caller ID</label>
        <select id="crazytel-caller-id" value={callerId} onChange={(event) => setCallerId(event.target.value)} disabled={callerIdsLoading || Boolean(callerIdError)}>
          <option value="">Use current trunk caller ID</option>
          {callerIds.map((item) => <option key={item.id} value={item.number}>{item.nickname ? `${item.nickname} · ` : ""}${item.number}</option>)}
        </select>
        {callerIdsLoading ? <small className={styles.visibilityMessage}>Loading verified caller IDs...</small> : null}
        {callerIdError ? <p className={styles.visibilityError} role="alert">{callerIdError}</p> : null}
        <small className={styles.visibilityMessage}>Saved as this agent&apos;s caller-ID assignment. Calling stays on the current trunk setup; the selected ID takes effect only after Crazytel enables Caller ID Passthrough.</small>
        <div className={styles.callingAssignmentActions}>
          <button type="button" onClick={() => void saveCallerId()} disabled={loading || callerIdsLoading || Boolean(callerIdError) || savingCallerId || saving || testing}>{savingCallerId ? "Saving caller ID..." : "Save caller ID"}</button>
        </div>
      </div>
    </>}
    {error ? <p className={styles.visibilityError} role="alert">{error}</p> : null}
    {notice ? <p className={styles.visibilityNotice} role="status">{notice}</p> : null}
    <footer><small>{registrationVerified ? "SIP login verified." : passwordSaved ? "Re-enter and verify the dedicated password to assign." : "Test the SIP login before assigning."}</small><div className={styles.callingAssignmentActions}><button type="button" onClick={() => void testRegistration()} disabled={loading || saving || testing || !selected || !password}>{testing ? "Testing SIP..." : "Test WebRTC login"}</button><button type="button" onClick={() => void save()} disabled={loading || saving || testing || !trunkId || !password || !registrationVerified}><Save size={14} />{saving ? "Assigning..." : "Assign trunk"}</button></div></footer>
  </section>;
}
