"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleCheck, CircleUserRound, UserPlus, UsersRound } from "lucide-react";

import styles from "@/components/workspace-shell.module.css";

type RosterUser = { id: string; profileId: string; name: string; email: string | null; role: string; isActive: boolean; appEmail: string | null };
type RosterPayload = { users: RosterUser[]; error?: string };

export default function AdminAgentRoster() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [users, setUsers] = useState<RosterUser[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState("");

  async function toggleRoster() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || loaded || loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/agents", { cache: "no-store" });
      const body = await response.text();
      if (!body.trim()) throw new Error(`The team list returned an empty response (HTTP ${response.status}). Check server configuration and try again.`);
      let payload: RosterPayload;
      try {
        payload = JSON.parse(body) as RosterPayload;
      } catch {
        throw new Error(`The team list returned an unreadable response (HTTP ${response.status}). Check server configuration and try again.`);
      }
      if (!response.ok) throw new Error(payload.error ?? `The team list could not be loaded (HTTP ${response.status}).`);
      if (!Array.isArray(payload.users)) throw new Error("The team list response did not contain a user list.");
      setUsers(payload.users ?? []);
      setLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The team list is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  async function inviteAgent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const result = await response.json() as { agent?: { id: string; email: string }; error?: string };
      if (!response.ok || !result.agent) throw new Error(result.error ?? "Agent invitation could not be sent.");
      setUsers((current) => [{ id: result.agent!.id, profileId: result.agent!.id, name: result.agent!.email, email: result.agent!.email, role: "agent", isActive: true, appEmail: result.agent!.email }, ...current]);
      setInviteEmail("");
      setNotice(`Invitation sent to ${result.agent.email}.`);
      setLoaded(true);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Agent invitation could not be sent.");
    } finally {
      setInviting(false);
    }
  }

  async function toggleAgent(user: RosterUser) {
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: user.profileId, isActive: !user.isActive }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Agent status could not be changed.");
      setUsers((current) => current.map((item) => item.profileId === user.profileId ? { ...item, isActive: !item.isActive } : item));
      setNotice(`${user.email ?? "Agent"} is now ${user.isActive ? "inactive" : "active"}.`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Agent status could not be changed.");
    }
  }

  const needle = search.trim().toLowerCase();
  const filteredUsers = users.filter((user) => !needle || user.name.toLowerCase().includes(needle) || user.email?.toLowerCase().includes(needle));

  return <section className={styles.roster}>
    <button type="button" className={styles.rosterToggle} onClick={() => void toggleRoster()} aria-expanded={open}>
      <UsersRound size={16} /><span>Agents</span><ChevronDown size={15} className={open ? styles.rosterChevronOpen : styles.rosterChevron} />
    </button>
    {open ? <div className={styles.rosterPanel}>
      {loading ? <p className={styles.rosterMessage}>Loading team members…</p> : null}
      {error ? <p className={styles.rosterError} role="alert">{error}</p> : null}
      {!loading && !error && users.length === 0 ? <p className={styles.rosterMessage}>No company agents yet. Invite an agent by email.</p> : null}
      {notice ? <p className={styles.rosterNotice} role="status">{notice}</p> : null}
      <form className={styles.agentInvite} onSubmit={(event) => void inviteAgent(event)}>
        <input type="email" required aria-label="Agent email" placeholder="agent@company.com" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
        <button type="submit" disabled={inviting} aria-label="Invite agent" title="Invite agent"><UserPlus size={15} /></button>
      </form>
      {users.length > 0 ? <>
        <input className={styles.rosterSearch} type="search" placeholder="Find a team member" aria-label="Search team members" value={search} onChange={(event) => setSearch(event.target.value)} />
        <ul className={styles.rosterList}>
          {filteredUsers.map((user) => <li key={user.profileId}>
            <span className={styles.rosterUserIcon}>{user.isActive ? <CircleCheck size={15} /> : <CircleUserRound size={15} />}</span>
            <Link href={`/agents/${encodeURIComponent(user.profileId)}`} className={styles.rosterUserInfo}><strong>{user.name}</strong><small>{user.email ?? user.role}</small></Link>
            <button type="button" className={user.isActive ? styles.rosterReady : styles.rosterNeedsSetup} onClick={() => void toggleAgent(user)} aria-label={`${user.isActive ? "Deactivate" : "Activate"} ${user.email}`} title={`${user.isActive ? "Deactivate" : "Activate"} agent`}>{user.isActive ? "Active" : "Inactive"}</button>
          </li>)}
          {filteredUsers.length === 0 ? <li className={styles.rosterMessage}>No matching users.</li> : null}
        </ul>
      </> : null}
    </div> : null}
  </section>;
}