"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, AudioLines, CalendarClock, ChevronRight, ContactRound, Mail, Plus, Search, UserRound, UserRoundCheck, UserRoundX, X } from "lucide-react";

import styles from "@/app/agents/agents.module.css";
import { AdminExportLink } from "@/components/admin-export-link";

type Agent = {
  id: string;
  profileId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  openContacts: number;
  calls: number;
  callbacks: number;
  activeSession: boolean;
};
type Filter = "all" | "active" | "inactive";

export default function AgentsManager() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/agents", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { users?: Agent[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Agent list could not be loaded.");
        return result.users ?? [];
      })
      .then((users) => { if (active) setAgents(users); })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : "Agent list could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const activeCount = agents.filter((agent) => agent.isActive).length;
  const inactiveCount = agents.length - activeCount;
  const openCount = agents.reduce((sum, agent) => sum + agent.openContacts, 0);
  const visibleAgents = agents.filter((agent) => {
    const matchesFilter = filter === "all" || (filter === "active" ? agent.isActive : !agent.isActive);
    const query = search.trim().toLowerCase();
    return matchesFilter && (!query || agent.name.toLowerCase().includes(query) || agent.email.toLowerCase().includes(query));
  });

  async function addAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/agents", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
      });
      const result = await response.json() as { agent?: { id: string; email: string }; error?: string };
      if (!response.ok || !result.agent) throw new Error(result.error ?? "Agent could not be added.");
      setAgents((current) => [{
        id: result.agent!.id, profileId: result.agent!.id, email: result.agent!.email, name: result.agent!.email,
        role: "agent", isActive: true, openContacts: 0, calls: 0, callbacks: 0, activeSession: false,
      }, ...current]);
      setNotice(`${result.agent.email} was added. They can request a sign-in code from the login page.`);
      setEmail("");
      setShowInvite(false);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Agent could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(agent: Agent) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/agents", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: agent.profileId, isActive: !agent.isActive }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Agent access could not be changed.");
      setAgents((current) => current.map((item) => item.profileId === agent.profileId ? { ...item, isActive: !item.isActive, activeSession: false } : item));
      setNotice(`${agent.email} is now ${agent.isActive ? "inactive" : "active"}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Agent access could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <section className={styles.summary} aria-label="Agent overview">
      <article><span className={styles.summaryIcon}><UserRoundCheck size={17} /></span><div><small>ACTIVE AGENTS</small><strong>{activeCount}</strong></div></article>
      <article><span className={styles.summaryIcon}><UserRoundX size={17} /></span><div><small>INACTIVE</small><strong>{inactiveCount}</strong></div></article>
      <article><span className={styles.summaryIcon}><ContactRound size={17} /></span><div><small>OPEN CONTACTS</small><strong>{openCount}</strong></div></article>
      <button className={styles.inviteButton} type="button" onClick={() => { setError(""); setShowInvite(true); }}><Plus size={16} /> Add agent</button>
    </section>

    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

    <section className={styles.directory} aria-label="Company agents">
      <header className={styles.directoryHeader}>
        <div><h2>Team directory</h2><span>{visibleAgents.length} of {agents.length} agents</span></div>
        <div className={styles.directoryActions}><AdminExportLink type="agents" /><label className={styles.search}><Search size={15} /><input type="search" placeholder="Find an agent" aria-label="Find an agent" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
      </header>
      <div className={styles.filterRow} role="tablist" aria-label="Filter agents">
        {(["all", "active", "inactive"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? styles.selectedFilter : styles.filterButton} onClick={() => setFilter(value)}>{value === "all" ? `All · ${agents.length}` : value === "active" ? `Active · ${activeCount}` : `Inactive · ${inactiveCount}`}</button>)}
      </div>
      {loading ? <div className={styles.empty}>Loading agents...</div> : visibleAgents.length ? <div className={styles.agentList}>
        {visibleAgents.map((agent) => <article className={styles.agentRow} key={agent.profileId}>
          <span className={styles.avatar}><UserRound size={20} /></span>
          <div className={styles.identity}><strong>{agent.name}</strong><span><Mail size={12} />{agent.email}</span></div>
          <span className={`${styles.status} ${agent.isActive ? styles.active : styles.inactive}`}><i />{agent.isActive ? "Active" : "Inactive"}</span>
          <div className={styles.metric}><ContactRound size={14} /><strong>{agent.openContacts}</strong><small>Open contacts</small></div>
          <div className={styles.metric}><AudioLines size={14} /><strong>{agent.calls}</strong><small>Calls</small></div>
          <div className={styles.metric}><CalendarClock size={14} /><strong>{agent.callbacks}</strong><small>Callbacks</small></div>
          <span className={agent.activeSession ? styles.sessionActive : styles.sessionIdle}><Activity size={13} />{agent.activeSession ? "Working" : "No session"}</span>
          <div className={styles.actions}>
            <button type="button" className={styles.accessButton} onClick={() => void toggleActive(agent)} disabled={busy}>{agent.isActive ? "Deactivate" : "Activate"}</button>
            <Link href={`/agents/${encodeURIComponent(agent.profileId)}`} className={styles.profileLink}>Profile <ChevronRight size={14} /></Link>
          </div>
        </article>)}
      </div> : <div className={styles.empty}><span className={styles.emptyIcon}><UserRound size={19} /></span><strong>{agents.length ? "No agents match this view" : "No agents yet"}</strong><p>{agents.length ? "Try another search or filter." : "Add an agent to build the company team."}</p>{!agents.length ? <button type="button" className={styles.emptyInvite} onClick={() => setShowInvite(true)}><Plus size={15} /> Add agent</button> : null}</div>}
    </section>

    {showInvite ? <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowInvite(false); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="add-agent-title">
        <header><div><span className={styles.dialogIcon}><UserRoundCheck size={17} /></span><div><h2 id="add-agent-title">Add an agent</h2><p>No invitation email is sent. They can request a one-time sign-in code from the login page.</p></div></div><button type="button" className={styles.closeButton} onClick={() => setShowInvite(false)} aria-label="Close add agent dialog" disabled={busy}><X size={17} /></button></header>
        <form onSubmit={(event) => void addAgent(event)}>
          <label>Work email<input autoFocus type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="agent@company.com" /></label>
          <p className={styles.inviteFootnote}>Agents can access only contacts assigned to them in this company.</p>
          <footer><button type="button" className={styles.cancelButton} onClick={() => setShowInvite(false)} disabled={busy}>Cancel</button><button type="submit" className={styles.inviteSubmit} disabled={busy || !email.trim()}><Plus size={15} />{busy ? "Adding..." : "Add agent"}</button></footer>
        </form>
      </section>
    </div> : null}
  </>;
}