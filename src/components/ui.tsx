import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { AlertTriangle, Search, X } from "lucide-react";

import styles from "@/components/ui.module.css";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button className={`${styles.button} ${styles[variant]} ${className}`} {...props} />;
}

export function SearchField({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`${styles.search} ${className}`}><Search size={15} aria-hidden="true" /><input type="search" {...props} /></label>;
}

export function FilterField({ label, className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; className?: string }) {
  return <label className={`${styles.filterField} ${className}`}><span>{label}</span><select {...props}>{children}</select></label>;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "success" | "warning" | "danger" | "neutral" }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

export function EmptyState({ title, detail, icon }: { title: string; detail?: string; icon?: ReactNode }) {
  return <div className={styles.empty}>{icon ? <span className={styles.emptyIcon}>{icon}</span> : null}<strong>{title}</strong>{detail ? <p>{detail}</p> : null}</div>;
}

export function ErrorState({ title, detail }: { title: string; detail: string }) {
  return <div className={styles.errorState} role="alert"><strong>{title}</strong><span>{detail}</span></div>;
}

export function InlineNotice({ tone = "info", children, className = "" }: { tone?: "info" | "success" | "warning" | "danger"; children: ReactNode; className?: string }) {
  return <div className={`${styles.notice} ${styles[`notice${tone[0].toUpperCase()}${tone.slice(1)}`]} ${className}`} role={tone === "danger" ? "alert" : "status"}>{children}</div>;
}

export function Avatar({ label, className = "" }: { label: string; className?: string }) {
  const initials = label.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return <span className={`${styles.avatar} ${className}`} aria-label={label}>{initials || "?"}</span>;
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className={styles.tooltip} title={label} aria-label={label}>{children}</span>;
}

export function LoadingSkeleton({ className = "", lines = 3 }: { className?: string; lines?: number }) {
  return <div className={`${styles.skeletonGroup} ${className}`} aria-label="Loading" role="status">{Array.from({ length: lines }, (_, index) => <span key={index} className={styles.skeletonLine} />)}</div>;
}

export function ConfirmDialog({ open, title, detail, confirmLabel = "Confirm", pending = false, onConfirm, onCancel }: {
  open: boolean; title: string; detail: string; confirmLabel?: string; pending?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-detail">
      <button type="button" className={styles.dialogClose} onClick={onCancel} aria-label="Close confirmation"><X size={16} /></button>
      <span className={styles.dialogIcon}><AlertTriangle size={18} /></span>
      <h2 id="confirm-title">{title}</h2>
      <p id="confirm-detail">{detail}</p>
      <div className={styles.dialogActions}><Button variant="secondary" onClick={onCancel} disabled={pending}>Cancel</Button><Button variant="primary" onClick={onConfirm} disabled={pending}>{pending ? "Saving..." : confirmLabel}</Button></div>
    </section>
  </div>;
}

export function Pagination({ page, pageCount, total, pageSize, onPageChange, onPageSizeChange }: {
  page: number; pageCount: number; total: number | null; pageSize: number;
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void;
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = total === null ? page * pageSize : Math.min(page * pageSize, total);
  return <div className={styles.pagination}>
    <span>{total === null ? `${first}–${last} loaded` : `${first}–${last} of ${total}`}</span>
    <label>Rows <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}><option>10</option><option>25</option><option>50</option><option>100</option></select></label>
    <div className={styles.pageButtons}><button type="button" onClick={() => onPageChange(1)} disabled={page <= 1} aria-label="First page">«</button><button type="button" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">‹</button><span>{page} / {Math.max(pageCount, 1)}</span><button type="button" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">›</button><button type="button" onClick={() => onPageChange(pageCount)} disabled={page >= pageCount} aria-label="Last page">»</button></div>
  </div>;
}