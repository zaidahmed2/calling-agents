import Link from "next/link";
import { Download } from "lucide-react";

import styles from "@/components/admin-export-link.module.css";

export function AdminExportLink({ type, query = "" }: { type: "contacts" | "calls" | "callbacks" | "agents" | "sessions" | "session-events"; query?: string }) {
  const suffix = query ? `&${query.replace(/^[?&]/, "")}` : "";
  return <Link className={styles.exportLink} href={`/api/admin/export?type=${type}${suffix}`}>
    <Download size={15} />{type === "session-events" ? "Export events" : "Export CSV"}
  </Link>;
}
