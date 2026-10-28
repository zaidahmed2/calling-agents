"use client";

import { useState } from "react";
import { CalendarClock, Check, Clock3, Phone, PhoneCall, RefreshCw } from "lucide-react";

import { Button, ConfirmDialog, EmptyState, Pagination, SearchField, StatusBadge } from "@/components/ui";
import AgentCallWorkflow, { startManualCall, unlockCallAudio, type InitialManualCall } from "@/app/contacts/[id]/agent-call-workflow";
import styles from "@/app/callbacks/callback-list.module.css";

export type CallbackCardData = {
  id: string;
  contactId: string;
  callContactId?: string;
  name: string;
  contactDetails: string[];
  phone: string | null;
  isAgent: boolean;
  dueAt: string;
  timezone: string;
  status: string;
  notes: string | null;
  dueLabel: "Overdue" | "Due today" | "Upcoming";
};

export default function CallbackList({ callbacks, page, pageSize, total }: { callbacks: CallbackCardData[]; page: number; pageSize: number; total: number }) {
  const [items, setItems] = useState(callbacks);
  const [search, setSearch] = useState("");
  const [dueFilter, setDueFilter] = useState("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<CallbackCardData | null>(null);
  const [dateTime, setDateTime] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeCall, setActiveCall] = useState<{ contactId: string; contactName: string; initialCall: InitialManualCall } | null>(null);
  const [startingCallId, setStartingCallId] = useState<string | null>(null);

  async function update(id: string, body: Record<string, string>) {
    setPending(id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/callbacks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Callback action failed.");
      setItems((current) => current.filter((item) => item.id !== id));
      setEditing(null);
      setDateTime("");
      setConfirming(null);
      setMessage(body.action === "complete" ? "Callback completed." : "Callback rescheduled.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Callback action failed.");
    } finally {
      setPending(null);
    }
  }

  async function startCallbackCall(item: CallbackCardData) {
    if (!item.callContactId || activeCall || startingCallId) return;
    setStartingCallId(item.id);
    setError("");
    try {
      unlockCallAudio();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support microphone calling.");
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      const initialCall = await startManualCall(item.callContactId);
      setActiveCall({ contactId: item.callContactId, contactName: item.name, initialCall });
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Call could not be started.");
    } finally {
      setStartingCallId(null);
    }
  }

  if (items.length === 0) return <EmptyState title="No callbacks to work" detail="Your active follow-ups will appear here." icon={<CalendarClock size={18} />} />;
  const query = search.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesSearch = !query || [item.name, ...item.contactDetails, item.isAgent ? null : item.phone, item.notes, item.isAgent ? null : item.contactId].some((value) => value?.toLowerCase().includes(query));
    return matchesSearch && (dueFilter === "all" || item.dueLabel === dueFilter);
  });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (nextPage: number, nextSize = pageSize) => `/callbacks?page=${nextPage}&size=${nextSize}`;

  return <div className={styles.list}>
    {message ? <div className={styles.success} role="status">{message}</div> : null}
    {error ? <div className={styles.error} role="alert">{error}</div> : null}
    <div className={styles.callbackToolbar}><SearchField value={search} onChange={(event) => setSearch(event.target.value)} placeholder={items[0]?.isAgent ? "Search visible contact details" : "Search this page"} aria-label={items[0]?.isAgent ? "Search callbacks by visible contact details" : "Search callbacks on this page"} /><label>Due status<select value={dueFilter} onChange={(event) => setDueFilter(event.target.value)}><option value="all">All active</option><option value="Overdue">Overdue</option><option value="Due today">Due today</option><option value="Upcoming">Upcoming</option></select></label><span>{filteredItems.length} shown · {total} total</span></div>
    {activeCall ? <AgentCallWorkflow key={activeCall.initialCall.call.call_id} contactId={activeCall.contactId} contactName={activeCall.contactName} initialCall={activeCall.initialCall} onCallSaved={(savedMessage) => { setMessage(savedMessage); setActiveCall(null); }} /> : null}
    {filteredItems.map((item) => <article className={styles.card} key={item.id}>
      <div className={styles.dateBlock}><CalendarClock size={17} /><strong>{new Date(item.dueAt).toLocaleDateString([], { month: "short", day: "numeric" })}</strong><span>{new Date(item.dueAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
      <div className={styles.details}><div className={styles.nameLine}><h2>{item.name}</h2><StatusBadge tone={item.dueLabel === "Overdue" ? "danger" : item.dueLabel === "Due today" ? "warning" : "neutral"}>{item.dueLabel}</StatusBadge></div>{item.isAgent ? item.contactDetails.map((detail, index) => <p key={`${item.id}-detail-${index}`}>{detail}</p>) : <p>Contact {item.contactId}</p>}{item.notes ? <blockquote>{item.notes}</blockquote> : null}<div className={styles.contactMeta}><span><Clock3 size={13} /> {item.status}</span>{item.isAgent ? item.phone ? <span>{item.phone}</span> : null : item.phone ? <a href={`tel:${item.phone}`}><Phone size={13} /> {item.phone}</a> : <span>Phone unavailable</span>}</div></div>
      <div className={styles.actions}>{item.isAgent && item.callContactId ? <Button variant="primary" disabled={Boolean(activeCall) || startingCallId !== null} onClick={() => void startCallbackCall(item)}><PhoneCall size={14} /> {startingCallId === item.id ? "Starting…" : "Call"}</Button> : null}<Button variant="primary" disabled={pending === item.id || Boolean(activeCall)} onClick={() => setConfirming(item)}><Check size={14} /> Complete callback</Button><Button variant="secondary" disabled={pending !== null || Boolean(activeCall)} onClick={() => { setEditing(editing === item.id ? null : item.id); setError(""); }}><RefreshCw size={14} /> Reschedule</Button>
        {editing === item.id ? <form className={styles.reschedule} onSubmit={(event) => { event.preventDefault(); if (dateTime) void update(item.id, { action: "reschedule", dueAt: new Date(dateTime).toISOString(), timezone: item.timezone }); }}><label>New date and time<input type="datetime-local" required value={dateTime} onChange={(event) => setDateTime(event.target.value)} /></label><Button type="submit" disabled={pending === item.id || !dateTime}>{pending === item.id ? "Saving…" : "Save time"}</Button></form> : null}
      </div>
    </article>)}
    {!filteredItems.length ? <EmptyState title="No matching callbacks" detail="Try another name, phone number, note, or due status." /> : null}
    <Pagination page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPageChange={(nextPage) => { window.location.href = pageHref(nextPage); }} onPageSizeChange={(nextSize) => { window.location.href = pageHref(1, nextSize); }} />
    <ConfirmDialog open={Boolean(confirming)} title="Complete this callback?" detail={confirming ? `Mark the follow-up for ${confirming.name} as complete?` : ""} confirmLabel="Complete callback" pending={pending === confirming?.id} onCancel={() => setConfirming(null)} onConfirm={() => { if (confirming) void update(confirming.id, { action: "complete" }); }} />
  </div>;
}
