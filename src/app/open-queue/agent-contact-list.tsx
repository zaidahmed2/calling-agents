"use client";

import Link from "next/link";
import { Fragment, useMemo, useState, startTransition } from "react";
import { ArrowUpRight, Eye, EyeOff, PhoneCall } from "lucide-react";

import { EmptyState, Pagination, SearchField, StatusBadge } from "@/components/ui";
import ProtectedPhone from "@/components/protected-phone";
import AgentCallWorkflow, { startManualCall, type InitialManualCall } from "@/app/contacts/[id]/agent-call-workflow";
import type { AgentContact } from "@/lib/ghl";
import styles from "@/app/open-queue/agent-contact-list.module.css";

export default function AgentContactList({ contacts, previousHref, nextHref, sourcePage }: { contacts: AgentContact[]; previousHref: string | null; nextHref: string | null; sourcePage: number }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [visiblePhone, setVisiblePhone] = useState<{ contactId: string; value: string } | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealError, setRevealError] = useState("");
  const [activeCall, setActiveCall] = useState<{ contact: AgentContact; initialCall: InitialManualCall } | null>(null);
  const [startingCallId, setStartingCallId] = useState<string | null>(null);
  const [callError, setCallError] = useState("");
  const [callNotice, setCallNotice] = useState("");
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((contact) => !query || contact.name.toLowerCase().includes(query) || contact.suburb?.toLowerCase().includes(query));
  }, [contacts, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  async function togglePhone(contact: AgentContact) {
    if (visiblePhone?.contactId === contact.id) {
      setVisiblePhone(null);
      setRevealError("");
      return;
    }
    setRevealingId(contact.id);
    setRevealError("");
    setVisiblePhone(null);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}/reveal`, { method: "POST", cache: "no-store" });
      const result = await response.json() as { phone?: string; error?: string };
      if (!response.ok || !result.phone) throw new Error(result.error ?? "Could not view this number.");
      const revealedPhone = result.phone;
      startTransition(() => setVisiblePhone({ contactId: contact.id, value: revealedPhone }));
      window.setTimeout(() => setVisiblePhone((current) => current?.contactId === contact.id ? null : current), 30_000);
    } catch (error) {
      setRevealError(error instanceof Error ? error.message : "Could not view this number.");
    } finally {
      setRevealingId(null);
    }
  }

  async function startContactCall(contact: AgentContact) {
    if (visiblePhone?.contactId !== contact.id || activeCall || startingCallId) return;
    setStartingCallId(contact.id);
    setCallError("");
    setCallNotice("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support microphone calling.");
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      const initialCall = await startManualCall(contact.id);
      setActiveCall({ contact, initialCall });
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Call could not be started.");
    } finally {
      setStartingCallId(null);
    }
  }

  return (
    <section className={styles.panel}>
      <header className={styles.toolbar}><div><strong>My assigned contacts</strong><small>{filtered.length} matching contacts in the loaded results</small></div><SearchField value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); setVisiblePhone(null); }} placeholder="Search name or suburb" aria-label="Search contacts by name or suburb" /></header>
      {revealError ? <p className={styles.revealError} role="alert">{revealError}</p> : null}
      {callError ? <p className={styles.revealError} role="alert">{callError}</p> : null}
      {callNotice ? <p className={styles.callNotice} role="status">{callNotice}</p> : null}
      {activeCall ? <AgentCallWorkflow key={activeCall.initialCall.call.call_id} contactId={activeCall.contact.id} contactName={activeCall.contact.name} initialCall={activeCall.initialCall} onCallSaved={(message) => { setCallNotice(message); setActiveCall(null); }} /> : null}
      <div className={styles.tableScroll}><table><thead><tr><th>CONTACT</th><th>SUBURB</th><th>PHONE</th><th>STATUS</th><th /></tr></thead><tbody>
        {visible.map((contact) => <Fragment key={contact.id}><tr><td><Link href={`/contacts/${encodeURIComponent(contact.id)}`} className={styles.name}>{contact.name}</Link></td><td>{contact.suburb ?? "—"}</td><td className={styles.phone}><span>{visiblePhone?.contactId === contact.id ? <ProtectedPhone phone={visiblePhone.value} /> : contact.maskedPhone}</span><button type="button" className={styles.revealButton} disabled={revealingId !== null || Boolean(activeCall) || Boolean(startingCallId)} onClick={() => void togglePhone(contact)} aria-label={visiblePhone?.contactId === contact.id ? `Hide number for ${contact.name}` : `View number for ${contact.name}`} title={visiblePhone?.contactId === contact.id ? "Hide number" : "View number"}>{visiblePhone?.contactId === contact.id ? <EyeOff size={14} /> : <Eye size={14} />}{revealingId === contact.id ? "Loading" : visiblePhone?.contactId === contact.id ? "Hide" : "View"}</button><button type="button" className={styles.callLink} onClick={() => void startContactCall(contact)} disabled={Boolean(activeCall) || startingCallId !== null} aria-label={`Start call to ${contact.name}`} title="Start in-app demo call"><PhoneCall size={14} />{startingCallId === contact.id ? "Starting" : "Call"}</button></td><td><StatusBadge tone="success">{contact.status}</StatusBadge></td><td><Link className={styles.openLink} href={`/contacts/${encodeURIComponent(contact.id)}`} aria-label={`Open ${contact.name}`}><ArrowUpRight size={15} /></Link></td></tr></Fragment>)}
      </tbody></table>
      {!visible.length ? <EmptyState title={search ? "No matching contacts" : nextHref ? "No assigned contacts on this page" : "You're all caught up"} detail={search ? "Try another name, email or phone." : "Only contacts assigned to you and marked Open appear here."} /> : null}</div>
      {filtered.length ? <Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /> : null}
      {previousHref || nextHref ? <nav className={styles.sourcePagination} aria-label="More assigned contacts"><span>Contact page {sourcePage}</span><div>{previousHref ? <Link href={previousHref}>Previous contacts</Link> : <span />}{nextHref ? <Link href={nextHref}>Next contacts</Link> : null}</div></nav> : null}
    </section>
  );
}