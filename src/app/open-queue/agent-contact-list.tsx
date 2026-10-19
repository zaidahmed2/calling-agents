"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, startTransition } from "react";
import { ArrowUpRight, Eye, EyeOff, MessageSquare, PhoneCall, Send, X } from "lucide-react";

import { EmptyState, Pagination, SearchField, StatusBadge } from "@/components/ui";
import ProtectedPhone from "@/components/protected-phone";
import AgentCallWorkflow, { startManualCall, type InitialManualCall } from "@/app/contacts/[id]/agent-call-workflow";
import type { AgentContact } from "@/lib/ghl";
import styles from "@/app/open-queue/agent-contact-list.module.css";

type ContactComment = { id: string; author: string; comment: string; createdAt: string };

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
  const [commentsContactId, setCommentsContactId] = useState<string | null>(null);
  const [comments, setComments] = useState<ContactComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsSaving, setCommentsSaving] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentsError, setCommentsError] = useState("");
  const [latestComments, setLatestComments] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(contacts.map((contact) => [contact.id, contact.lastComment])),
  );
  useEffect(() => {
    if (!commentsContactId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !commentsSaving) setCommentsContactId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [commentsContactId, commentsSaving]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((contact) => !query
      || contact.name.toLowerCase().includes(query)
      || contact.email?.toLowerCase().includes(query)
      || contact.details.some((field) => field.value.toLowerCase().includes(query)));
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

  async function toggleComments(contact: AgentContact) {
    if (commentsContactId === contact.id) {
      setCommentsContactId(null);
      setCommentsError("");
      return;
    }
    setCommentsContactId(contact.id);
    setComments([]);
    setCommentText("");
    setCommentsError("");
    setCommentsLoading(true);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}/comments`, { cache: "no-store" });
      const result = await response.json() as { comments?: ContactComment[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Comments could not be loaded.");
      setComments(result.comments ?? []);
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : "Comments could not be loaded.");
    } finally {
      setCommentsLoading(false);
    }
  }

  async function addComment(contact: AgentContact) {
    const comment = commentText.trim();
    if (!comment || commentsSaving) return;
    setCommentsSaving(true);
    setCommentsError("");
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      const result = await response.json() as { comment?: ContactComment; error?: string };
      if (!response.ok || !result.comment) throw new Error(result.error ?? "Comment could not be saved.");
      const savedComment = result.comment;
      setComments((current) => [...current, savedComment]);
      setLatestComments((current) => ({ ...current, [contact.id]: comment }));
      setCommentText("");
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : "Comment could not be saved.");
    } finally {
      setCommentsSaving(false);
    }
  }

  const selectedContact = contacts.find((contact) => contact.id === commentsContactId) ?? null;
  const showPhone = contacts.some((contact) => contact.phoneVisible);
  const showStatus = contacts.some((contact) => contact.status !== null);

  return (
    <section className={styles.panel}>
      <header className={styles.toolbar}><div><strong>My assigned contacts</strong><small>{filtered.length} matching contacts in the loaded results</small></div><SearchField value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); setVisiblePhone(null); }} placeholder="Search contacts" aria-label="Search visible contact details" /></header>
      {revealError ? <p className={styles.revealError} role="alert">{revealError}</p> : null}
      {callError ? <p className={styles.revealError} role="alert">{callError}</p> : null}
      {callNotice ? <p className={styles.callNotice} role="status">{callNotice}</p> : null}
      {activeCall ? <AgentCallWorkflow key={activeCall.initialCall.call.call_id} contactId={activeCall.contact.id} contactName={activeCall.contact.name} initialCall={activeCall.initialCall} onCallSaved={(message) => { setCallNotice(message); setActiveCall(null); }} /> : null}
      <div className={styles.tableScroll}><table><thead><tr><th>CONTACT</th><th>DETAILS</th>{showPhone ? <th>PHONE</th> : null}{showStatus ? <th>STATUS</th> : null}<th>LATEST COMMENT</th><th>ACTIONS</th></tr></thead><tbody>
        {visible.map((contact) => <tr key={contact.id}><td><Link href={`/contacts/${encodeURIComponent(contact.id)}`} className={styles.name}>{contact.name}</Link></td><td><div className={styles.detailList}>{contact.details.length ? contact.details.map((field) => <span key={field.id}><small>{field.label}</small>{field.value}</span>) : <span className={styles.muted}>No additional details</span>}</div></td>{showPhone ? <td className={styles.phone}>{contact.phoneVisible ? <><span>{visiblePhone?.contactId === contact.id ? <ProtectedPhone phone={visiblePhone.value} /> : contact.maskedPhone ?? "•••• ••••"}</span><button type="button" className={styles.revealButton} disabled={revealingId !== null || Boolean(activeCall) || Boolean(startingCallId)} onClick={() => void togglePhone(contact)} aria-label={visiblePhone?.contactId === contact.id ? `Hide number for ${contact.name}` : `View number for ${contact.name}`} title={visiblePhone?.contactId === contact.id ? "Hide number" : "View number"}>{visiblePhone?.contactId === contact.id ? <EyeOff size={14} /> : <Eye size={14} />}{revealingId === contact.id ? "Loading" : visiblePhone?.contactId === contact.id ? "Hide" : "View"}</button><button type="button" className={styles.callLink} onClick={() => void startContactCall(contact)} disabled={Boolean(activeCall) || startingCallId !== null} aria-label={`Start call to ${contact.name}`} title="Start in-app demo call"><PhoneCall size={14} />{startingCallId === contact.id ? "Starting" : "Call"}</button></> : null}</td> : null}{showStatus ? <td>{contact.status ? <StatusBadge tone="success">{contact.status}</StatusBadge> : null}</td> : null}<td className={styles.latestComment}>{latestComments[contact.id] ? latestComments[contact.id] : <span className={styles.muted}>No comments yet</span>}</td><td className={styles.actions}><button type="button" className={styles.commentButton} disabled={commentsSaving} onClick={() => void toggleComments(contact)} aria-expanded={commentsContactId === contact.id} aria-label={`Open comments for ${contact.name}`}><MessageSquare size={14} />Comments</button><Link className={styles.openLink} href={`/contacts/${encodeURIComponent(contact.id)}`} aria-label={`Open ${contact.name}`}><ArrowUpRight size={15} /></Link></td></tr>)}
      </tbody></table>
      {!visible.length ? <EmptyState title={search ? "No matching contacts" : nextHref ? "No assigned contacts on this page" : "You're all caught up"} detail={search ? "Try another name, email or phone." : "Only contacts assigned to you and marked Open appear here."} /> : null}</div>
      {filtered.length ? <Pagination page={page} pageCount={pageCount} total={filtered.length} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} /> : null}
      {previousHref || nextHref ? <nav className={styles.sourcePagination} aria-label="More assigned contacts"><span>Contact page {sourcePage}</span><div>{previousHref ? <Link href={previousHref}>Previous contacts</Link> : <span />}{nextHref ? <Link href={nextHref}>Next contacts</Link> : null}</div></nav> : null}
      {selectedContact ? <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !commentsSaving) setCommentsContactId(null); }}>
        <section className={styles.commentsDialog} role="dialog" aria-modal="true" aria-labelledby="contact-comments-title">
          <header><div><span className={styles.modalEyebrow}>CONTACT ACTIVITY</span><h2 id="contact-comments-title">{selectedContact.name}</h2><p>Review previous comments or add an update for the team.</p></div><button type="button" className={styles.closeComments} onClick={() => setCommentsContactId(null)} aria-label="Close comments" disabled={commentsSaving}><X size={17} /></button></header>
          <div className={styles.modalDetails}>{selectedContact.status ? <span><small>Status</small>{selectedContact.status}</span> : null}{selectedContact.details.map((field) => <span key={field.id}><small>{field.label}</small>{field.value}</span>)}</div>
          <div className={styles.commentThread} aria-live="polite">{commentsError ? <p className={styles.commentsError} role="alert">{commentsError}</p> : null}{commentsLoading ? <p className={styles.commentsMuted}>Loading comments...</p> : comments.length ? <ol className={styles.commentsList}>{comments.map((item) => <li key={item.id}><p>{item.comment}</p><small>{item.author} · {new Date(item.createdAt).toLocaleString()}</small></li>)}</ol> : !commentsLoading ? <p className={styles.commentsMuted}>No comments yet. Add the first update below.</p> : null}</div>
          <form className={styles.commentForm} onSubmit={(event) => { event.preventDefault(); void addComment(selectedContact); }}><label htmlFor="new-contact-comment">Add a comment</label><textarea id="new-contact-comment" rows={3} maxLength={2000} value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Write a note for the team..." autoFocus /><footer><small>{commentText.length}/2000</small><button type="submit" className={styles.commentSubmit} disabled={!commentText.trim() || commentsSaving}><Send size={14} />{commentsSaving ? "Saving..." : "Post comment"}</button></footer></form>
        </section>
      </div> : null}
    </section>
  );
}