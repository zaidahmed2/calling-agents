import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity, AudioLines, CalendarClock, ChartNoAxesCombined, ContactRound, LayoutDashboard, LogOut, Settings2, UsersRound, UserRoundCog } from "lucide-react";

import { logout, returnToSuperAdmin } from "@/app/dashboard/actions";
import { AppSession } from "@/lib/auth";
import WorkSessionTimer from "@/app/open-queue/work-session-timer";
import styles from "@/components/workspace-shell.module.css";

type WorkspaceSection = "overview" | "contacts" | "agents" | "calls" | "callbacks" | "sessions" | "settings";

const adminLinks = [
  { key: "overview", href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { key: "contacts", href: "/contacts", label: "Contacts", icon: ContactRound },
  { key: "agents", href: "/agents", label: "Agents", icon: UserRoundCog },
  { key: "calls", href: "/calls", label: "Call history", icon: AudioLines },
  { key: "callbacks", href: "/callbacks", label: "Callbacks", icon: CalendarClock },
  { key: "sessions", href: "/sessions", label: "Agent activity", icon: Activity },
  { key: "settings", href: "/settings", label: "Settings", icon: Settings2 },
] as const;

const agentLinks = [
  { key: "contacts", href: "/open-queue", label: "My contacts", icon: ContactRound },
  { key: "callbacks", href: "/callbacks", label: "My callbacks", icon: CalendarClock },
  { key: "sessions", href: "/my-sessions", label: "My sessions", icon: Activity },
] as const;

export function WorkspaceShell({
  session,
  section,
  title,
  subtitle,
  children,
}: {
  session: AppSession;
  section: WorkspaceSection;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const isAdmin = session.role === "admin";
  if (!isAdmin && (section === "overview" || section === "calls" || section === "settings")) {
    redirect("/open-queue");
  }
  const links = isAdmin ? adminLinks : agentLinks;
  const initials = session.displayName.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");

  return (
    <main className={styles.layout}>
      <aside className={styles.sidebar}>
        <Link href={isAdmin ? "/dashboard" : "/open-queue"} className={styles.brand}>
          <span className={styles.brandMark}>T</span>
          <span><small>TERRAVERSE</small><strong>CRM</strong></span>
        </Link>
        <div className={styles.workspaceLabel}>{isAdmin ? "ADMIN WORKSPACE" : "MY WORKSPACE"}</div>
        <nav className={styles.nav} aria-label={isAdmin ? "Admin navigation" : "Agent navigation"}>
          {links.map(({ key, href, label, icon: Icon }) => (
            <Link href={href} key={key} aria-current={section === key ? "page" : undefined} className={section === key ? styles.active : styles.navLink}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        {isAdmin ? <Link href="/settings" className={styles.adminSettings}><ChartNoAxesCombined size={16} /> System & integrations</Link> : null}
        <div className={styles.account}>
          <span className={styles.avatar}>{initials || <UsersRound size={15} />}</span>
          <span className={styles.accountText}><strong>{session.displayName}</strong><small>{isAdmin ? "Administrator" : "Calling agent"}</small></span>
          <form action={logout}><button type="submit" className={styles.logout} aria-label="Log out" title="Log out"><LogOut size={16} /></button></form>
        </div>
      </aside>
      <section className={styles.main}>
        {session.isImpersonating ? <div className={styles.platformContext}>
          <span>You are viewing this company as a Super Admin.</span>
          <form action={returnToSuperAdmin}><button type="submit">Return to Super Admin</button></form>
        </div> : null}
        <header className={styles.pageHeader}>
          <div><div className={styles.breadcrumb}>{isAdmin ? "ADMINISTRATION" : "CALLING WORKSPACE"} <span>/</span> {title.toUpperCase()}</div><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}</div>
          <div className={styles.headerRole}>{isAdmin ? "ADMIN" : "AGENT"}</div>
        </header>
        {!isAdmin ? <WorkSessionTimer /> : null}
        {children}
      </section>
    </main>
  );
}