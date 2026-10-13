"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleCheck, CircleUserRound, UsersRound } from "lucide-react";

import styles from "@/components/workspace-shell.module.css";

type RosterUser = { id: string; profileId: string; name: string; email: string | null; role: string; isMappedAgent: boolean; appEmail: string | null };
type RosterPayload = { users: RosterUser[]; error?: string };

export default function AdminAgentRoster() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [users, setUsers] = useState<RosterUser[]>([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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

  const needle = search.trim().toLowerCase();
  const filteredUsers = users.filter((user) => !needle || user.name.toLowerCase().includes(needle) || user.email?.toLowerCase().includes(needle));

  return <section className={styles.roster}>
    <button type="button" className={styles.rosterToggle} onClick={() => void toggleRoster()} aria-expanded={open}>
      <UsersRound size={16} /><span>Agents</span><ChevronDown size={15} className={open ? styles.rosterChevronOpen : styles.rosterChevron} />
    </button>
    {open ? <div className={styles.rosterPanel}>
      {loading ? <p className={styles.rosterMessage}>Loading team members…</p> : null}
      {error ? <p className={styles.rosterError} role="alert">{error}</p> : null}
      {!loading && !error && users.length === 0 ? <p className={styles.rosterMessage}>No active agents with a GHL user mapping were found.</p> : null}
      {users.length > 0 ? <>
        <input className={styles.rosterSearch} type="search" placeholder="Find a team member" aria-label="Search team members" value={search} onChange={(event) => setSearch(event.target.value)} />
        <ul className={styles.rosterList}>
          {filteredUsers.map((user) => <li key={user.profileId}>
            <span className={styles.rosterUserIcon}>{user.isMappedAgent ? <CircleCheck size={15} /> : <CircleUserRound size={15} />}</span>
            <Link href={`/agents/${encodeURIComponent(user.profileId)}`} className={styles.rosterUserInfo}><strong>{user.name}</strong><small>{user.email ?? user.role}</small></Link>
            <span className={user.isMappedAgent ? styles.rosterReady : styles.rosterNeedsSetup}>{user.isMappedAgent ? "Ready" : "Needs GHL mapping"}</span>
          </li>)}
          {filteredUsers.length === 0 ? <li className={styles.rosterMessage}>No matching users.</li> : null}
        </ul>
      </> : null}
    </div> : null}
  </section>;
}