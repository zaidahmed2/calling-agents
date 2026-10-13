"use client";

import { useActionState, useState } from "react";

import { requestOtp, submitOtp } from "@/app/login/actions";
import styles from "@/app/login/page.module.css";

const initialState = {
  ok: false,
  message: "",
};

export default function LoginPage() {
  const [requestState, requestAction, isRequestPending] = useActionState(requestOtp, initialState);
  const [verifyState, verifyAction, isVerifyPending] = useActionState(submitOtp, initialState);
  const [email, setEmail] = useState("");

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-label="Application login">
        <div className={styles.header}>
          <span className={styles.badge}>Secure access</span>
          <h1>Sign in</h1>
          <p>Sign in with your provisioned work email. Access is assigned by your administrator.</p>
        </div>

        {!requestState.ok ? (
          <>
            <form action={requestAction} className={styles.form}>
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
              <button type="submit" disabled={isRequestPending}>
                {isRequestPending ? "Sending..." : "Send OTP"}
              </button>
            </form>

            {requestState.message && !requestState.ok ? (
              <div className={`${styles.notice} ${styles.error}`} role="alert">
                <strong>Request not accepted</strong>
                <span>{requestState.message}</span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className={`${styles.notice} ${styles.success}`} role="status">
              <strong>Check your inbox</strong>
              <span>{requestState.message}</span>
              <span>{email}</span>
            </div>

            <form action={verifyAction} className={styles.form}>
              <input type="hidden" name="email" value={email} />
              <label htmlFor="otp-code">One-time code</label>
              <input
                id="otp-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={32}
                autoComplete="one-time-code"
                autoFocus
                required
              />
              <button type="submit" disabled={isVerifyPending}>
                {isVerifyPending ? "Verifying..." : "Verify & continue"}
              </button>
            </form>

            {verifyState.message ? (
              <div className={`${styles.notice} ${verifyState.ok ? styles.success : styles.error}`} role="alert">
                <strong>{verifyState.ok ? "Success" : "Unable to continue"}</strong>
                <span>{verifyState.message}</span>
              </div>
            ) : null}

            <button type="button" className={styles.backButton} onClick={() => window.location.reload()}>
              Use a different email
            </button>
          </>
        )}
      </section>
    </main>
  );
}
