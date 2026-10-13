"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";

import type { GhlContact, GhlCursor } from "@/lib/ghl";
import { Pagination, SearchField, StatusBadge } from "@/components/ui";
import styles from "@/app/contacts/contacts-manager.module.css";

type Agent = { id: string; email: string; ghlUserId: string; name: string };
type ContactRow = GhlContact & { lastCallAt: string | null };
type ApiState = { contacts: ContactRow[]; nextCursor: GhlCursor | null; total: number | null; agents: Agent[]; statusFieldConfigured: boolean };
type UpdateResult = { results: Array<{ contactId: string; ok: boolean; message: string }>; succeeded: number; failed: number };

export default function ContactsManager({ initialData, initialError = "" }: { initialData: ApiState; initialError?: string }) {
  const [data, setData] = useState<ApiState>(initialData);
  const [cursor, setCursor] = useState<GhlCursor | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<GhlCursor | null>>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [sort, setSort] = useState<{ key: "name" | "status" | "agent"; direction: "asc" | "desc" }>({ key: "name", direction: "asc" });
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");

  async function loadPage(nextCursor: GhlCursor | null, history = cursorHistory, requestedPageSize = pageSize) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("limit", String(requestedPageSize));
      if (nextCursor?.startAfter) params.set("startAfter", nextCursor.startAfter);
      if (nextCursor?.startAfterId) params.set("startAfterId", nextCursor.startAfterId);
      const response = await fetch(`/api/admin/contacts?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as ApiState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not load GHL contacts.");
      setData(payload);
      setCursor(nextCursor);
      setCursorHistory(history);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load GHL contacts.");
    } finally {
      setLoading(false);
    }
  }

  const filteredContacts = data.contacts.filter((contact) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || contact.name.toLowerCase().includes(needle) || contact.id.toLowerCase().includes(needle) || contact.email?.toLowerCase().includes(needle) || contact.phone?.includes(needle);
    const matchesStatus = statusFilter === "all" || (statusFilter === "unknown" ? !contact.status : contact.status?.toLowerCase() === statusFilter);
    const matchesAgent = agentFilter === "all" || (agentFilter === "unassigned" ? !contact.assignedUserId : contact.assignedUserId === agentFilter);
    return matchesSearch && matchesStatus && matchesAgent;
  });
  const visibleContacts = [...filteredContacts].sort((left, right) => {
    const leftValue = sort.key === "name" ? left.name : sort.key === "status" ? left.status ?? "" : data.agents.find((agent) => agent.ghlUserId === left.assignedUserId)?.email ?? "";
    const rightValue = sort.key === "name" ? right.name : sort.key === "status" ? right.status ?? "" : data.agents.find((agent) => agent.ghlUserId === right.assignedUserId)?.email ?? "";
    return leftValue.localeCompare(rightValue) * (sort.direction === "asc" ? 1 : -1);
  });
  const allVisibleSelected = visibleContacts.length > 0 && visibleContacts.every((contact) => selected.includes(contact.id));

  function toggleContact(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function toggleVisible() {
    setSelected((current) => allVisibleSelected
      ? current.filter((id) => !visibleContacts.some((contact) => contact.id === id))
      : [...new Set([...current, ...visibleContacts.map((contact) => contact.id)])]);
  }

  function changePageSize(value: number) {
    setPageSize(value);
    setCursor(null);
    setCursorHistory([]);
    void loadPage(null, [], value);
  }

  function changeSort(key: "name" | "status" | "agent") {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
  }

  const currentPage = cursorHistory.length + 1;
  const pageCount = data.total !== null ? Math.ceil(data.total / pageSize) : currentPage + (data.nextCursor ? 1 : 0);
  const formatDate = (value: string | null) => value ? new Date(value).toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—";
  async function applyChanges() {
    if (selected.length === 0 || (!assignedTo && !status)) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const body: Record<string, unknown> = { contactIds: selected };
      if (assignedTo) body.assignedTo = assignedTo === "__unassign__" ? null : assignedTo;
      if (status) body.status = status;
      const response = await fetch("/api/admin/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as UpdateResult & { error?: string };
      if (!response.ok && !result.results) throw new Error(result.error ?? "Contact update failed.");
      setNotice(`${result.succeeded} contact${result.succeeded === 1 ? "" : "s"} updated in GHL${result.failed ? `; ${result.failed} failed` : ""}.`);
      if (result.failed) setError(result.results.filter((item) => !item.ok).map((item) => `${item.contactId}: ${item.message}`).join(" "));
      setSelected([]);
      setAssignedTo("");
      setStatus("");
      await loadPage(cursor);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Contact update failed.");
    } finally {
      setSaving(false);
    }
  }

  function nextPage() {
    if (!data.nextCursor) return;
    void loadPage(data.nextCursor, [...cursorHistory, cursor]);
  }

  function previousPage() {
    if (cursorHistory.length === 0) return;
    const previous = cursorHistory[cursorHistory.length - 1];
    void loadPage(previous, cursorHistory.slice(0, -1));
  }

  return (
    <>
      <section className={styles.summaryBar}>
        <div><span className={styles.summaryIcon}>↻</span><div><strong>Contacts from Terraverse</strong><p>{data.total === null ? `${data.contacts.length} loaded on this page; source did not provide a total.` : `${data.total.toLocaleString()} total contacts.`} Assignment and status are read from the contact source.</p></div></div>
        <button type="button" className={styles.refreshButton} onClick={() => void loadPage(cursor)} disabled={loading}>↻ <span>Refresh</span></button>
      </section>

      {!data.statusFieldConfigured ? <div className={styles.warning} role="status"><strong>Status field key was not resolved.</strong><span>Contacts remain visible, but status changes are disabled. Set GHL_CONTACT_STATUS_FIELD_KEY to the exact key from GHL custom fields.</span></div> : null}
      {data.agents.length === 0 ? <div className={styles.warning} role="status"><strong>No assignable agents are configured.</strong><span>Contact assignment is limited to active Terraverse agents mapped to verified non-admin users.</span></div> : null}
      {error ? <div className={styles.error} role="alert"><strong>Could not complete operation</strong><span>{error}</span></div> : null}
      {notice ? <div className={styles.success} role="status">{notice}</div> : null}

      <section className={styles.tablePanel}>
        <div className={styles.tableToolbar}>
          <div className={styles.selectionInfo}><strong>All contacts</strong><span>{selected.length ? `${selected.length} selected` : "Assignment and status are source-of-truth values"}</span></div>
          <SearchField value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded contacts" aria-label="Search loaded contacts" />
        </div>

        <div className={styles.filters}>
          <label>Status <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="unknown">Unknown</option>{[...new Set(data.contacts.flatMap((contact) => contact.status ? [contact.status] : []))].filter((value) => value.toLowerCase() !== "open").map((value) => <option value={value.toLowerCase()} key={value}>{value}</option>)}</select></label>
          <label>Assigned agent <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}><option value="all">All agents</option><option value="unassigned">Unassigned</option>{data.agents.map((agent) => <option value={agent.ghlUserId} key={agent.id}>{agent.email}</option>)}</select></label>
          <span className={styles.filterCount}>{visibleContacts.length} shown on this source page</span>
        </div>

        {selected.length > 0 ? (
          <div className={styles.bulkBar}>
            <span>{selected.length} selected</span>
            <label><span>Assign to</span><select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}><option value="">No assignment change</option><option value="__unassign__">Unassign</option>{data.agents.map((agent) => <option value={agent.ghlUserId} key={agent.id}>{agent.name} · {agent.email}</option>)}</select></label>
            <label><span>Set status</span><input value={status} onChange={(event) => setStatus(event.target.value)} disabled={!data.statusFieldConfigured} maxLength={80} placeholder="Enter status, e.g. Open" /></label>
            <button type="button" onClick={() => void applyChanges()} disabled={saving || (!assignedTo && !status)}>{saving ? "Saving..." : "Apply changes"}</button>
          </div>
        ) : null}

        <div className={styles.tableScroll}>
          <table>
            <thead><tr><th><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select visible contacts" /></th><th><button className={styles.sortButton} onClick={() => changeSort("name")}>CONTACT {sort.key === "name" ? sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowDownUp size={12} />}</button></th><th>EMAIL</th><th>PHONE</th><th><button className={styles.sortButton} onClick={() => changeSort("status")}>STATUS {sort.key === "status" ? sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowDownUp size={12} />}</button></th><th><button className={styles.sortButton} onClick={() => changeSort("agent")}>ASSIGNED AGENT {sort.key === "agent" ? sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowDownUp size={12} />}</button></th><th>LAST ACTIVITY</th><th>LAST CALL</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {visibleContacts.map((contact) => {
                const agent = data.agents.find((item) => item.ghlUserId === contact.assignedUserId);
                return <tr key={contact.id}>
                  <td><input type="checkbox" checked={selected.includes(contact.id)} onChange={() => toggleContact(contact.id)} aria-label={`Select ${contact.name}`} /></td>
                  <td><strong>{contact.name}</strong><small>{contact.id}</small></td>
                  <td>{contact.email ?? "—"}</td>
                  <td>{contact.phone ?? "—"}</td>
                  <td><StatusBadge tone={contact.isOpen ? "success" : contact.status ? "neutral" : "warning"}>{contact.status ?? "Unknown"}</StatusBadge></td>
                  <td>{agent?.email ?? (contact.assignedUserId ? "Mapped agent not active" : "Unassigned")}</td>
                  <td>{formatDate(contact.lastActivityAt)}</td>
                  <td>{formatDate(contact.lastCallAt)}</td>
                  <td><Link href={`/contacts/${encodeURIComponent(contact.id)}`} className={styles.viewContact} aria-label={`Open ${contact.name}`}><ExternalLink size={14} /></Link></td>
                </tr>;
              })}
              {!loading && visibleContacts.length === 0 ? <tr><td colSpan={9} className={styles.empty}>{error ? "Contacts are unavailable." : search || statusFilter !== "all" || agentFilter !== "all" ? "No contacts on this page match these filters." : "No contacts returned for this location."}</td></tr> : null}
              {loading ? <tr><td colSpan={9} className={styles.empty}>Loading contacts...</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pagination page={currentPage} pageCount={pageCount} total={data.total} pageSize={pageSize} onPageChange={(page) => { if (page < currentPage) previousPage(); else if (page > currentPage) nextPage(); }} onPageSizeChange={changePageSize} />
      </section>
    </>
  );
}