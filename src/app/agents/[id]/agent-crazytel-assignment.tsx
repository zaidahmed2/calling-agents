"use client";

import { useEffect, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import { Registerer, UserAgent } from "sip.js";

import styles from "@/app/agents/[id]/agent-detail.module.css";

type Trunk = { id: string; username: string; enabled: boolean; caller_id_number: string | null; description: string | null; assignedToOtherAgent?: boolean; manual?: boolean };
type Assignment = { trunks?: Trunk[]; selectedTrunkId?: string | null; selectedUsername?: string | null; passwordSaved?: boolean; error?: string };

export default function AgentCrazytelAssignment({ agentId }: { agentId: string }) {
  const [trunks, setTrunks] = useState<Trunk[]>([]);
  const [trunkId, setTrunkId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(false);
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
        setTrunks(result.trunks ?? []);
        setTrunkId(result.selectedTrunkId ?? "");
        setUsername(result.selectedUsername ?? "");
        setPasswordSaved(Boolean(result.passwordSaved));
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Crazytel settings could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agentId]);

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/crazytel`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trunkId, username, webrtcPassword: password, manual: selected?.manual === true, callerId: selected?.caller_id_number }),
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

  const selected = trunks.find((trunk) => trunk.id === trunkId);

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
            {trunks.map((trunk) => <option key={trunk.id} value={trunk.id} disabled={trunk.assignedToOtherAgent}>{trunk.username}{trunk.caller_id_number ? ` · ${trunk.caller_id_number}` : ""}{trunk.description ? ` · ${trunk.description}` : ""}{trunk.assignedToOtherAgent ? " · assigned to another agent" : ""}</option>)}
          </select>
        </label>
        <label className={styles.callingAssignmentField}>Dedicated WebRTC password
          <input type="password" autoComplete="new-password" value={password} onChange={(event) => { setPassword(event.target.value); setRegistrationVerified(false); }} placeholder={passwordSaved ? "Saved securely; enter to replace" : "WebRTC password for this trunk"} />
        </label>
      </div>
      {selected ? <p className={styles.visibilityMessage}>SIP identity: <code>sip:{selected.username}@hybrid.sip.crazytel.net.au</code></p> : null}
      {selected?.caller_id_number ? <p className={styles.visibilityMessage}>This trunk presents its Crazytel-configured caller ID: <strong>{selected.caller_id_number}</strong>.</p> : null}
      <p className={styles.visibilityMessage}>The app automatically formats contact numbers for Crazytel PSTN dialing. The registration test checks WebRTC login only; it does not place a call.</p>
    </>}
    {error ? <p className={styles.visibilityError} role="alert">{error}</p> : null}
    {notice ? <p className={styles.visibilityNotice} role="status">{notice}</p> : null}
    <footer><small>{registrationVerified ? "SIP login verified." : passwordSaved ? "Re-enter and verify the dedicated password to assign." : "Test the SIP login before assigning."}</small><div className={styles.callingAssignmentActions}><button type="button" onClick={() => void testRegistration()} disabled={loading || saving || testing || !selected || !password}>{testing ? "Testing SIP..." : "Test WebRTC login"}</button><button type="button" onClick={() => void save()} disabled={loading || saving || testing || !trunkId || !password || !registrationVerified}><Save size={14} />{saving ? "Assigning..." : "Assign trunk"}</button></div></footer>
  </section>;
}
