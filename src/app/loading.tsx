import styles from "@/app/loading.module.css";

export default function Loading() {
  return (
    <main className={styles.screen} role="status" aria-live="polite" aria-label="Loading workspace">
      <div className={styles.topBar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>T</span>
          <span className={styles.brandName}><small>TERRAVERSE</small><strong>CRM</strong></span>
        </div>
        <span className={styles.topBarPulse} />
      </div>

      <div className={styles.workspace}>
        <aside className={styles.sidebar} aria-hidden="true">
          <span className={`${styles.line} ${styles.sidebarTitle}`} />
          <span className={`${styles.line} ${styles.navActive}`} />
          <span className={`${styles.line} ${styles.navLine}`} />
          <span className={`${styles.line} ${styles.navLine}`} />
          <span className={`${styles.line} ${styles.navLine}`} />
          <span className={`${styles.line} ${styles.navLineShort}`} />
          <div className={styles.sidebarAccount}><span /><i /></div>
        </aside>

        <section className={styles.content}>
          <div className={styles.heading}>
            <div><span className={`${styles.line} ${styles.eyebrow}`} /><span className={`${styles.line} ${styles.title}`} /></div>
            <span className={styles.headingAction} />
          </div>
          <div className={styles.loadingCard}>
            <span className={styles.spinner} aria-hidden="true" />
            <strong>Preparing your workspace</strong>
            <span className={styles.loadingCopy}>Loading the latest company data…</span>
            <span className={styles.progressTrack}><i /></span>
          </div>
          <div className={styles.cards} aria-hidden="true">
            <div className={styles.skeletonCard}><span /><i /></div>
            <div className={styles.skeletonCard}><span /><i /></div>
            <div className={styles.skeletonCard}><span /><i /></div>
          </div>
          <div className={styles.tableSkeleton} aria-hidden="true">
            <span className={styles.tableHeader} />
            <span /><span /><span /><span />
          </div>
        </section>
      </div>
      <span className={styles.srOnly}>Please wait while this page loads.</span>
    </main>
  );
}
