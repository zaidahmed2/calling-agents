"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownUp, ArrowUp, ArrowDown, Check, ExternalLink, FileSpreadsheet, Plus, RefreshCw, Upload, UserRoundPlus, X } from "lucide-react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";

import { AdminExportLink } from "@/components/admin-export-link";
import AgentCheckboxGroup from "@/components/agent-checkbox-group";
import type { GhlContact, GhlCursor } from "@/lib/ghl";
import { Pagination, SearchField, StatusBadge } from "@/components/ui";
import styles from "@/app/contacts/contacts-manager.module.css";

type Agent = { id: string; email: string; ghlUserId: string; name: string };
type ContactRow = GhlContact & { lastCallAt: string | null; latestCallStatus: "picked" | "not-picked" | "not-called" | "in-progress" | "unknown" };
type ApiState = { contacts: ContactRow[]; nextCursor: GhlCursor | null; total: number | null; agents: Agent[]; statusFieldConfigured: boolean };
type UpdateResult = { results: Array<{ contactId: string; ok: boolean; message: string }>; succeeded: number; failed: number };
type ImportMapping = { name: string; firstName: string; lastName: string; phone: string; email: string; status: string; subject: string; notes: string; leadSource: string };
type ImportRow = Record<string, unknown>;
const importFields: Array<{ key: keyof ImportMapping; label: string }> = [
  { key: "name", label: "Contact name" }, { key: "firstName", label: "First name" }, { key: "lastName", label: "Last name" },
  { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "status", label: "Status" },
  { key: "subject", label: "Subject" }, { key: "notes", label: "Notes" }, { key: "leadSource", label: "Lead source" },
];

function guessColumn(headers: string[], field: keyof ImportMapping): string {
  const patterns: Record<keyof ImportMapping, RegExp> = {
    name: /^(name|contact name|full name)$/i,
    firstName: /^(first name|firstname|first)$/i,
    lastName: /^(last name|lastname|surname|last)$/i,
    phone: /^(phone|phone number|mobile|telephone)$/i,
    email: /^(email|email address)$/i,
    status: /^(status|contact status)$/i,
    subject: /^(subject|lead subject)$/i,
    notes: /^(notes|note|comments)$/i,
    leadSource: /^(lead source|source)$/i,
  };
  return headers.find((header) => patterns[field].test(header.trim())) ?? "";
}

export default function ContactsManager({ initialData, initialError = "" }: { initialData: ApiState; initialError?: string }) {
  const [data, setData] = useState<ApiState>(initialData);
  const [cursor, setCursor] = useState<GhlCursor | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<GhlCursor | null>>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] = useState<"none" | "assign" | "unassign">("none");
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [callFilter, setCallFilter] = useState("all");
  const [sort, setSort] = useState<{ key: "name" | "status" | "agent"; direction: "asc" | "desc" }>({ key: "name", direction: "asc" });
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", phone: "", email: "", status: "open", subject: "", notes: "", assignedAgentIds: [] as string[] });
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importMapping, setImportMapping] = useState<ImportMapping>({ name: "", firstName: "", lastName: "", phone: "", email: "", status: "", subject: "", notes: "", leadSource: "" });
  const [importFileName, setImportFileName] = useState("");
  const [importDuplicates, setImportDuplicates] = useState<Array<{ row: number; email?: string; phone?: string; reason: string }>>([]);
  const [importInvalidRows, setImportInvalidRows] = useState<Array<{ row: number; error: string }>>([]);
  const [importBusy, setImportBusy] = useState(false);

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
      if (!response.ok) throw new Error(payload.error ?? "Could not load CRM contacts.");
      setData(payload);
      setCursor(nextCursor);
      setCursorHistory(history);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load CRM contacts.");
    } finally {
      setLoading(false);
    }
  }

  const filteredContacts = data.contacts.filter((contact) => {
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || contact.name.toLowerCase().includes(needle) || contact.id.toLowerCase().includes(needle) || contact.email?.toLowerCase().includes(needle) || contact.phone?.includes(needle);
    const matchesStatus = statusFilter === "all" || (statusFilter === "unknown" ? !contact.status : contact.status?.toLowerCase() === statusFilter);
    const assignedIds = contact.assignedAgentIds ?? (contact.assignedUserId ? [contact.assignedUserId] : []);
    const matchesAgent = agentFilter === "all" || (agentFilter === "unassigned" ? assignedIds.length === 0 : assignedIds.includes(agentFilter));
    const matchesCall = callFilter === "all" || contact.latestCallStatus === callFilter;
    return matchesSearch && matchesStatus && matchesAgent && matchesCall;
  });
  const visibleContacts = [...filteredContacts].sort((left, right) => {
    const leftAssigned = left.assignedAgentIds ?? (left.assignedUserId ? [left.assignedUserId] : []);
    const rightAssigned = right.assignedAgentIds ?? (right.assignedUserId ? [right.assignedUserId] : []);
    const leftValue = sort.key === "name" ? left.name : sort.key === "status" ? left.status ?? "" : data.agents.find((agent) => leftAssigned.includes(agent.id))?.email ?? "";
    const rightValue = sort.key === "name" ? right.name : sort.key === "status" ? right.status ?? "" : data.agents.find((agent) => rightAssigned.includes(agent.id))?.email ?? "";
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
    if (selected.length === 0 || (assignmentMode === "none" && !status) || (assignmentMode === "assign" && assignedAgentIds.length === 0)) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const body: Record<string, unknown> = { contactIds: selected };
      if (assignmentMode !== "none") body.assignedAgentIds = assignmentMode === "unassign" ? [] : assignedAgentIds;
      if (status) body.status = status;
      const response = await fetch("/api/admin/contacts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as UpdateResult & { error?: string };
      if (!response.ok && !result.results) throw new Error(result.error ?? "Contact update failed.");
      setNotice(`${result.succeeded} contact${result.succeeded === 1 ? "" : "s"} updated in the CRM${result.failed ? `; ${result.failed} failed` : ""}.`);
      if (result.failed) setError(result.results.filter((item) => !item.ok).map((item) => `${item.contactId}: ${item.message}`).join(" "));
      setSelected([]);
      setAssignmentMode("none");
      setAssignedAgentIds([]);
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

  async function createContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newContact),
      });
      const result = await response.json() as { error?: string; imported?: number };
      if (!response.ok) throw new Error(result.error ?? "Contact could not be created.");
      setNewContact({ name: "", phone: "", email: "", status: "open", subject: "", notes: "", assignedAgentIds: [] });
      setShowCreate(false);
      setNotice("Contact created in the company CRM.");
      await loadPage(null, []);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Contact could not be created.");
    } finally {
      setCreateBusy(false);
    }
  }

  function mappedImportRows() {
    return importRows.map((row) => {
      const get = (field: keyof ImportMapping) => importMapping[field] ? String(row[importMapping[field]] ?? "").trim() : "";
      return {
        name: get("name") || [get("firstName"), get("lastName")].filter(Boolean).join(" "),
        firstName: get("firstName"),
        lastName: get("lastName"),
        phone: get("phone"),
        email: get("email"),
        status: get("status") || "open",
        subject: get("subject"),
        notes: get("notes"),
        leadSource: get("leadSource"),
      };
    });
  }

  async function readImportFile(file?: File) {
    setError("");
    setNotice("");
    setImportDuplicates([]);
    setImportInvalidRows([]);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a spreadsheet smaller than 10 MB.");
      return;
    }
    try {
      let rows: ImportRow[];
      if (file.name.toLowerCase().endsWith(".csv")) {
        const parsed = Papa.parse<ImportRow>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (header) => header.trim() });
        if (parsed.errors.length) throw new Error("The CSV contains invalid rows or inconsistent columns.");
        rows = parsed.data;
      } else if (file.name.toLowerCase().endsWith(".xlsx")) {
        const sheetRows = (await readXlsxFile(file))[0]?.data ?? [];
        if (sheetRows.length < 2) throw new Error("The spreadsheet has no contact rows.");
        const headers = sheetRows[0].map((value) => String(value ?? "").trim());
        rows = sheetRows.slice(1).flatMap((values) => {
          const record: ImportRow = {};
          headers.forEach((header, index) => { if (header) record[header] = String(values[index] ?? "").trim(); });
          return Object.values(record).some((value) => String(value).trim()) ? [record] : [];
        });
      } else {
        throw new Error("Choose a CSV or XLSX file.");
      }
      if (!rows.length || rows.length > 500) throw new Error("The first worksheet must contain between 1 and 500 contact rows.");
      const headers = Object.keys(rows[0]);
      const mapping = Object.fromEntries(importFields.map(({ key }) => [key, guessColumn(headers, key)])) as ImportMapping;
      if (!mapping.name && !mapping.firstName) throw new Error("Map a contact name or first-name column to continue.");
      setImportFileName(file.name);
      setImportHeaders(headers);
      setImportRows(rows);
      setImportMapping(mapping);
      setImportBusy(true);
      const response = await fetch("/api/admin/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: rows.map((row) => {
          const get = (field: keyof ImportMapping) => mapping[field] ? String(row[mapping[field]] ?? "").trim() : "";
          return { name: get("name") || [get("firstName"), get("lastName")].filter(Boolean).join(" "), firstName: get("firstName"), lastName: get("lastName"), phone: get("phone"), email: get("email"), status: get("status") || "open", subject: get("subject"), notes: get("notes"), leadSource: get("leadSource") };
        }), preview: true }),
      });
      const result = await response.json() as { error?: string; duplicates?: typeof importDuplicates; invalidRows?: typeof importInvalidRows };
      if (!response.ok) throw new Error(result.error ?? "The spreadsheet could not be previewed.");
      setImportDuplicates(result.duplicates ?? []);
      setImportInvalidRows(result.invalidRows ?? []);
    } catch (importError) {
      setImportRows([]);
      setError(importError instanceof Error ? importError.message : "Could not read this spreadsheet.");
    } finally {
      setImportBusy(false);
    }
  }

  async function confirmImport() {
    if (!importRows.length) return;
    setImportBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: mappedImportRows() }),
      });
      const result = await response.json() as { error?: string; imported?: number; skippedDuplicates?: number; invalidRows?: typeof importInvalidRows };
      if (!response.ok) throw new Error(result.error ?? "Import failed.");
      setNotice(`${result.imported ?? 0} imported; ${result.skippedDuplicates ?? 0} duplicates and ${result.invalidRows?.length ?? 0} invalid rows skipped.`);
      setImportRows([]);
      setImportHeaders([]);
      setImportDuplicates([]);
      setImportInvalidRows([]);
      setImportFileName("");
      await loadPage(null, []);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed.");
    } finally {
      setImportBusy(false);
    }
  }

  function closeImport() {
    if (importBusy) return;
    setImportRows([]);
    setImportHeaders([]);
    setImportDuplicates([]);
    setImportInvalidRows([]);
    setImportFileName("");
  }

  return (
    <>
      <section className={styles.summaryBar}>
        <div><span className={styles.summaryIcon}>↻</span><div><strong>Company CRM contacts</strong><p>{data.total === null ? `${data.contacts.length} loaded on this page.` : `${data.total.toLocaleString()} contacts in this company.`} Contact records and assignments are managed here.</p></div></div>
        <div className={styles.actionGroup}>
          <AdminExportLink type="contacts" />
          <button type="button" className={styles.iconAction} onClick={() => void loadPage(cursor)} disabled={loading} aria-label="Refresh contacts" title="Refresh contacts"><RefreshCw size={15} />{loading ? "Refreshing" : "Refresh"}</button>
          <button type="button" className={styles.secondaryAction} onClick={() => { setError(""); setNotice(""); setShowCreate(true); }}><UserRoundPlus size={15} />Add contact</button>
          <label className={styles.primaryAction}><Upload size={15} />Import file<input type="file" accept=".csv,.xlsx" onChange={(event) => void readImportFile(event.target.files?.[0])} hidden /></label>
        </div>
      </section>

      {showCreate ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !createBusy) setShowCreate(false); }}>
        <section className={styles.contactDialog} role="dialog" aria-modal="true" aria-labelledby="create-contact-title">
          <header className={styles.dialogHeader}><div className={styles.dialogHeading}><span className={styles.dialogIcon}><UserRoundPlus size={17} /></span><div><span className={styles.dialogEyebrow}>COMPANY CRM</span><h2 id="create-contact-title">Add contact</h2><p>Create a contact record for this company.</p></div></div><button type="button" className={styles.dialogClose} onClick={() => setShowCreate(false)} disabled={createBusy} aria-label="Close dialog"><X size={17} /></button></header>
          <form className={styles.contactForm} onSubmit={(event) => void createContact(event)}>
            <div className={styles.contactFormGrid}>
              <label className={styles.formWide}>Contact name<input autoFocus required value={newContact.name} onChange={(event) => setNewContact((current) => ({ ...current, name: event.target.value }))} placeholder="Full name" /></label>
              <label>Phone<input type="tel" value={newContact.phone} onChange={(event) => setNewContact((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone number" /></label>
              <label>Email<input type="email" value={newContact.email} onChange={(event) => setNewContact((current) => ({ ...current, email: event.target.value }))} placeholder="name@company.com" /></label>
              <label>Status<input required maxLength={80} value={newContact.status} onChange={(event) => setNewContact((current) => ({ ...current, status: event.target.value }))} /></label>
              <AgentCheckboxGroup agents={data.agents} selectedIds={newContact.assignedAgentIds} onChange={(ids) => setNewContact((current) => ({ ...current, assignedAgentIds: ids }))} />
              <label className={styles.formWide}>Subject<input value={newContact.subject} onChange={(event) => setNewContact((current) => ({ ...current, subject: event.target.value }))} placeholder="Optional lead subject" /></label>
              <label className={styles.formWide}>Notes<textarea rows={3} maxLength={5000} value={newContact.notes} onChange={(event) => setNewContact((current) => ({ ...current, notes: event.target.value }))} placeholder="Add useful context for the team" /></label>
            </div>
            {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
            <footer className={styles.dialogFooter}><button type="button" className={styles.dialogCancel} onClick={() => setShowCreate(false)} disabled={createBusy}>Cancel</button><button type="submit" className={styles.dialogSubmit} disabled={createBusy || !newContact.name.trim()}><Plus size={15} />{createBusy ? "Creating..." : "Create contact"}</button></footer>
          </form>
        </section>
      </div> : null}

      {importRows.length ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImport(); }}>
        <section className={`${styles.contactDialog} ${styles.importDialog}`} role="dialog" aria-modal="true" aria-labelledby="import-contact-title">
          <header className={styles.dialogHeader}><div className={styles.dialogHeading}><span className={styles.dialogIcon}><FileSpreadsheet size={17} /></span><div><span className={styles.dialogEyebrow}>SPREADSHEET IMPORT</span><h2 id="import-contact-title">Review contacts</h2><p>{importFileName}</p></div></div><button type="button" className={styles.dialogClose} onClick={closeImport} disabled={importBusy} aria-label="Close dialog"><X size={17} /></button></header>
          <div className={styles.importSummary}><span><strong>{importRows.length}</strong> rows</span><span><strong>{importRows.length - importInvalidRows.length - importDuplicates.length}</strong> ready</span><span><strong>{importDuplicates.length}</strong> duplicates</span><span><strong>{importInvalidRows.length}</strong> invalid</span></div>
          {importBusy ? <div className={styles.importLoading}><RefreshCw size={14} /> Checking rows and duplicates...</div> : null}
          <div className={styles.mappingPanel}><div><strong>Map spreadsheet columns</strong><small>Choose which spreadsheet columns fill each CRM field.</small></div><div className={styles.mappingGrid}>{importFields.map(({ key, label }) => <label key={key}>{label}<select value={importMapping[key]} onChange={(event) => setImportMapping((current) => ({ ...current, [key]: event.target.value }))}><option value="">Skip field</option>{importHeaders.map((header) => <option key={`${key}-${header}`} value={header}>{header}</option>)}</select></label>)}</div></div>
          <div className={styles.previewWrap}><strong>Contact preview</strong><div><table><thead><tr><th>ROW</th><th>NAME</th><th>EMAIL</th><th>PHONE</th><th>STATUS</th></tr></thead><tbody>{mappedImportRows().slice(0, 8).map((row, index) => <tr key={index}><td>{index + 1}</td><td>{row.name || "Missing name"}</td><td>{row.email || "—"}</td><td>{row.phone || "—"}</td><td>{row.status}</td></tr>)}</tbody></table></div><small>Showing up to 8 of {importRows.length} spreadsheet rows.</small></div>
          {importDuplicates.length || importInvalidRows.length ? <div className={styles.validationList}>{importDuplicates.length ? <div><strong>Duplicate rows</strong>{importDuplicates.slice(0, 5).map((item) => <span key={`${item.row}-${item.reason}`}>Row {item.row}: {item.reason}</span>)}</div> : null}{importInvalidRows.length ? <div><strong>Needs correction</strong>{importInvalidRows.slice(0, 5).map((item) => <span key={`${item.row}-${item.error}`}>Row {item.row}: {item.error}</span>)}</div> : null}</div> : null}
          {error ? <p className={`${styles.dialogError} ${styles.importDialogError}`} role="alert">{error}</p> : null}
          <footer className={styles.dialogFooter}><button type="button" className={styles.dialogCancel} onClick={closeImport} disabled={importBusy}>Cancel</button><button type="button" className={styles.dialogSubmit} onClick={() => void confirmImport()} disabled={importBusy || importRows.length - importInvalidRows.length - importDuplicates.length <= 0}><Check size={15} />{importBusy ? "Importing..." : "Import ready contacts"}</button></footer>
        </section>
      </div> : null}

      {!data.statusFieldConfigured ? <div className={styles.warning} role="status"><strong>Status field key was not resolved.</strong><span>Contacts remain visible, but status changes are disabled.</span></div> : null}
      {data.agents.length === 0 ? <div className={styles.warning} role="status"><strong>No assignable agents are configured.</strong><span>Invite an active agent from the Agents page to assign company contacts.</span></div> : null}
      {error ? <div className={styles.error} role="alert"><strong>Could not complete operation</strong><span>{error}</span></div> : null}
      {notice ? <div className={styles.success} role="status">{notice}</div> : null}

      <section className={styles.tablePanel}>
        <div className={styles.tableToolbar}>
          <div className={styles.selectionInfo}><strong>All contacts</strong><span>{selected.length ? `${selected.length} selected` : "Company-owned CRM records"}</span></div>
          <SearchField value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded contacts" aria-label="Search loaded contacts" />
        </div>

        <div className={styles.filters}>
          <label>Status <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="unknown">Unknown</option>{[...new Set(data.contacts.flatMap((contact) => contact.status ? [contact.status] : []))].filter((value) => value.toLowerCase() !== "open").map((value) => <option value={value.toLowerCase()} key={value}>{value}</option>)}</select></label>
          <label>Assigned agent <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}><option value="all">All agents</option><option value="unassigned">Unassigned</option>{data.agents.map((agent) => <option value={agent.id} key={agent.id}>{agent.email}</option>)}</select></label>
          <label>Call result <select value={callFilter} onChange={(event) => setCallFilter(event.target.value)}><option value="all">All call results</option><option value="picked">Picked</option><option value="not-picked">Not picked</option><option value="not-called">Not called</option><option value="in-progress">In progress</option></select></label>
          <span className={styles.filterCount}>{visibleContacts.length} shown on this page</span>
        </div>

        {selected.length > 0 ? (
          <div className={styles.bulkBar}>
            <span>{selected.length} selected</span>
            <label><span>Assignment</span><select value={assignmentMode} onChange={(event) => setAssignmentMode(event.target.value as typeof assignmentMode)}><option value="none">No assignment change</option><option value="assign">Assign selected agents</option><option value="unassign">Unassign all</option></select></label>
            {assignmentMode === "assign" ? <AgentCheckboxGroup agents={data.agents} selectedIds={assignedAgentIds} onChange={setAssignedAgentIds} /> : null}
            <label><span>Set status</span><input value={status} onChange={(event) => setStatus(event.target.value)} maxLength={80} placeholder="Enter status, e.g. Open" /></label>
            <button type="button" onClick={() => void applyChanges()} disabled={saving || (assignmentMode === "none" && !status) || (assignmentMode === "assign" && !assignedAgentIds.length)}>{saving ? "Saving..." : "Apply changes"}</button>
          </div>
        ) : null}

        <div className={styles.tableScroll}>
          <table>
            <thead><tr><th><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select visible contacts" /></th><th><button className={styles.sortButton} onClick={() => changeSort("name")}>CONTACT {sort.key === "name" ? sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowDownUp size={12} />}</button></th><th>EMAIL</th><th>PHONE</th><th><button className={styles.sortButton} onClick={() => changeSort("status")}>STATUS {sort.key === "status" ? sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowDownUp size={12} />}</button></th><th><button className={styles.sortButton} onClick={() => changeSort("agent")}>ASSIGNED AGENT {sort.key === "agent" ? sort.direction === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowDownUp size={12} />}</button></th><th>LAST ACTIVITY</th><th>LAST CALL</th><th>CALL RESULT</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {visibleContacts.map((contact) => {
                const assignedIds = contact.assignedAgentIds ?? (contact.assignedUserId ? [contact.assignedUserId] : []);
                const assignedNames = data.agents.filter((item) => assignedIds.includes(item.id)).map((item) => item.email);
                return <tr key={contact.id}>
                  <td><input type="checkbox" checked={selected.includes(contact.id)} onChange={() => toggleContact(contact.id)} aria-label={`Select ${contact.name}`} /></td>
                  <td><strong>{contact.name}</strong><small>{contact.id}</small></td>
                  <td>{contact.email ?? "—"}</td>
                  <td>{contact.phone ?? "—"}</td>
                  <td><StatusBadge tone={contact.isOpen ? "success" : contact.status ? "neutral" : "warning"}>{contact.status ?? "Unknown"}</StatusBadge></td>
                  <td>{assignedNames.length ? assignedNames.join(", ") : assignedIds.length ? "Agent unavailable" : "Unassigned"}</td>
                  <td>{formatDate(contact.lastActivityAt)}</td>
                  <td>{formatDate(contact.lastCallAt)}</td>
                  <td><StatusBadge tone={contact.latestCallStatus === "picked" ? "success" : contact.latestCallStatus === "not-picked" ? "warning" : "neutral"}>{contact.latestCallStatus === "not-called" ? "Not called" : contact.latestCallStatus === "in-progress" ? "In progress" : contact.latestCallStatus === "unknown" ? "Unknown" : contact.latestCallStatus}</StatusBadge></td>
                  <td><Link href={`/contacts/${encodeURIComponent(contact.id)}`} className={styles.viewContact} aria-label={`Open ${contact.name}`}><ExternalLink size={14} /></Link></td>
                </tr>;
              })}
              {!loading && visibleContacts.length === 0 ? <tr><td colSpan={10} className={styles.empty}>{error ? "Contacts are unavailable." : search || statusFilter !== "all" || agentFilter !== "all" || callFilter !== "all" ? "No contacts on this page match these filters." : "No contacts in this company yet."}</td></tr> : null}
              {loading ? <tr><td colSpan={10} className={styles.empty}>Loading contacts...</td></tr> : null}
            </tbody>
          </table>
        </div>
        <Pagination page={currentPage} pageCount={pageCount} total={data.total} pageSize={pageSize} onPageChange={(page) => { if (page < currentPage) previousPage(); else if (page > currentPage) nextPage(); }} onPageSizeChange={changePageSize} />
      </section>
    </>
  );
}