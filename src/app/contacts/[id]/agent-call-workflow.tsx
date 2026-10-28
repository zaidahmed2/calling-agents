"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, PhoneCall, PhoneOff } from "lucide-react";
import { Inviter, Registerer, SessionState, UserAgent, Web } from "sip.js";

import { Button, StatusBadge } from "@/components/ui";
import { buildCrazytelCallerIdHeaders } from "@/lib/crazytel-utils";
import styles from "@/app/contacts/[id]/contact-profile.module.css";

type StartedCall = { call_id: string; requested_at: string; ended_at?: string | null; manual_duration_seconds?: number | null };
type CallStage = "picked" | "not-picked" | "call-later" | "busy" | "interested";
type TelephonyConfig = { websocketServer: string; sipUri: string; webrtcPassword: string; targetUri: string; turnUrls: string[]; turnUsername?: string; turnPassword?: string; outboundCallerId?: string; recordingNoticeEnabled: boolean };
export type InitialManualCall = { call: StartedCall; telephony: TelephonyConfig };

let callAudioContext: AudioContext | null = null;

export function unlockCallAudio() {
  if (typeof window === "undefined" || !window.AudioContext) return;
  callAudioContext ??= new window.AudioContext();
  void callAudioContext.resume();
}

export async function startManualCall(contactId: string): Promise<InitialManualCall> {
  const response = await fetch("/api/calls/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start", contactId }),
  });
  const result = await response.json() as { call?: StartedCall; telephony?: TelephonyConfig; error?: string };
  if (!response.ok || !result.call || !result.telephony) {
    throw new Error(result.error ?? "Calling is not configured for this company yet. Contact your administrator.");
  }
  return { call: result.call, telephony: result.telephony };
}

export async function endManualCall(callId: string): Promise<{ ended_at: string; manual_duration_seconds: number }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("/api/calls/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end", callId }),
      signal: controller.signal,
    });
    const result = await response.json() as { result?: { ended_at?: string; manual_duration_seconds?: number }; error?: string };
    if (!response.ok || !result.result?.ended_at) throw new Error(result.error ?? "Call could not be ended. Try again.");
    return { ended_at: result.result.ended_at, manual_duration_seconds: result.result.manual_duration_seconds ?? 0 };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The call ended, but saving its status is taking too long. Retry End to resync the call record.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function AgentCallWorkflow({ contactId, contactName, initialCall, onCallSaved }: { contactId: string; contactName: string; initialCall?: InitialManualCall; onCallSaved?: (message: string) => void }) {
  const router = useRouter();
  const [call, setCall] = useState<StartedCall | null>(initialCall?.call ?? null);
  const [telephony, setTelephony] = useState<TelephonyConfig | null>(initialCall?.telephony ?? null);
  const [callStatus, setCallStatus] = useState("Ready");
  const [finishing, setFinishing] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [outcome, setOutcome] = useState<CallStage>("not-picked");
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ringbackOscillatorRef = useRef<OscillatorNode | null>(null);
  const ringbackGainRef = useRef<GainNode | null>(null);
  const ringbackTimerRef = useRef<number | null>(null);
  const recordingNoticeStartedRef = useRef(false);
  const userAgentRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const inviterRef = useRef<Inviter | null>(null);
  const endedRef = useRef(false);
  const answeredAtRef = useRef<number | null>(null);
  const answeredStatePromiseRef = useRef<Promise<void> | null>(null);
  const reportedProviderStateRef = useRef<"ringing" | "answered" | null>(null);
  const resultStatusRef = useRef<string | null>(null);
  const endCallRef = useRef<(sendBye: boolean) => Promise<void>>(async () => undefined);

  function stopRingback() {
    if (ringbackTimerRef.current !== null) {
      window.clearInterval(ringbackTimerRef.current);
      ringbackTimerRef.current = null;
    }
    if (ringbackGainRef.current && callAudioContext) {
      ringbackGainRef.current.gain.cancelScheduledValues(callAudioContext.currentTime);
      ringbackGainRef.current.gain.setTargetAtTime(0, callAudioContext.currentTime, 0.02);
    }
    const oscillator = ringbackOscillatorRef.current;
    ringbackOscillatorRef.current = null;
    ringbackGainRef.current = null;
    if (oscillator) {
      try { oscillator.stop(); } catch { /* Oscillator may already be stopped. */ }
    }
  }

  function startRingback() {
    if (endedRef.current || answeredAtRef.current !== null || ringbackOscillatorRef.current) return;
    unlockCallAudio();
    if (!callAudioContext) return;
    const oscillator = callAudioContext.createOscillator();
    const gain = callAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 400;
    gain.gain.value = 0;
    oscillator.connect(gain);
    gain.connect(callAudioContext.destination);
    oscillator.start();
    ringbackOscillatorRef.current = oscillator;
    ringbackGainRef.current = gain;

    const playCadence = () => {
      if (!callAudioContext || ringbackGainRef.current !== gain || endedRef.current || answeredAtRef.current !== null) return;
      const startAt = callAudioContext.currentTime + 0.03;
      gain.gain.cancelScheduledValues(startAt);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.14, startAt + 0.025);
      gain.gain.setValueAtTime(0.14, startAt + 0.38);
      gain.gain.linearRampToValueAtTime(0, startAt + 0.42);
      gain.gain.setValueAtTime(0, startAt + 0.62);
      gain.gain.linearRampToValueAtTime(0.14, startAt + 0.645);
      gain.gain.setValueAtTime(0.14, startAt + 1.0);
      gain.gain.linearRampToValueAtTime(0, startAt + 1.04);
    };
    playCadence();
    ringbackTimerRef.current = window.setInterval(playCadence, 3000);
  }

  function announceThenRingback(configuration: TelephonyConfig) {
    if (recordingNoticeStartedRef.current) {
      startRingback();
      return;
    }
    recordingNoticeStartedRef.current = true;
    const message = configuration.recordingNoticeEnabled
      ? "Your call will be recorded."
      : "Please wait while we connect your call.";
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      startRingback();
      if (configuration.recordingNoticeEnabled) setError("Audio notice could not be played. Confirm the recording disclosure before continuing.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.onend = startRingback;
    utterance.onerror = () => {
      if (configuration.recordingNoticeEnabled) setError("Audio notice could not be played. Confirm the recording disclosure before continuing.");
      startRingback();
    };
    window.speechSynthesis.speak(utterance);
  }

  async function stopTelephony() {
    stopRingback();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const registerer = registererRef.current;
    const userAgent = userAgentRef.current;
    registererRef.current = null;
    inviterRef.current = null;
    userAgentRef.current = null;
    if (registerer) void registerer.unregister().catch(() => undefined);
    if (userAgent) await userAgent.stop().catch((stopError: unknown) => {
      console.error("Could not stop the Crazytel WebRTC user agent.", stopError);
    });
  }

  const cleanupTelephonyOnUnmount = useEffectEvent(() => {
    stopRingback();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    void stopTelephony();
  });

  async function reportProviderCallState(callId: string, providerCallId: string, providerState: "ringing" | "answered") {
    if (endedRef.current) return;
    if (reportedProviderStateRef.current === "answered" || reportedProviderStateRef.current === providerState) return;
    if (!callId) throw new Error("Call record was not initialized before connecting to Crazytel.");
    reportedProviderStateRef.current = providerState;
    let response: Response;
    try {
      response = await fetch("/api/calls/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "provider-state", callId, providerCallId, providerState }),
      });
    } catch (error) {
      if (reportedProviderStateRef.current === providerState) reportedProviderStateRef.current = null;
      throw error;
    }
    const result = await response.json() as { error?: string };
    if (!response.ok) {
      if (reportedProviderStateRef.current === providerState) reportedProviderStateRef.current = null;
      throw new Error(result.error ?? "Crazytel call state could not be linked.");
    }
  }

  async function connectAndDial(configuration: TelephonyConfig, callRecordId: string) {
    const sipUri = UserAgent.makeURI(configuration.sipUri);
    const targetUri = UserAgent.makeURI(configuration.targetUri);
    if (!sipUri || !targetUri) throw new Error("The configured Crazytel SIP identity or outbound dial target is invalid.");

    setCallStatus("Connecting to Crazytel");
    const userPart = configuration.sipUri.replace(/^sips?:/i, "").split("@")[0];
    const iceServers: RTCIceServer[] = configuration.turnUrls.map((urls) => ({
      urls,
      ...(configuration.turnUsername && configuration.turnPassword ? { username: configuration.turnUsername, credential: configuration.turnPassword } : {}),
    }));
    const userAgent = new UserAgent({
      uri: sipUri,
      authorizationUsername: userPart,
      authorizationPassword: configuration.webrtcPassword,
      transportOptions: { server: configuration.websocketServer },
      sessionDescriptionHandlerFactoryOptions: { peerConnectionConfiguration: { iceServers } },
      logBuiltinEnabled: false,
      logConfiguration: false,
      userAgentString: "Terraverse CRM WebRTC",
    });
    userAgentRef.current = userAgent;
    await userAgent.start();

    const registerer = new Registerer(userAgent);
    registererRef.current = registerer;
    await registerer.register();

    setCallStatus("Dialing");
    const inviter = new Inviter(userAgent, targetUri, {
      extraHeaders: buildCrazytelCallerIdHeaders(configuration.outboundCallerId),
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
    });
    const providerCallId = inviter.request.callId;
    inviterRef.current = inviter;
    inviter.stateChange.addListener((state) => {
      if (state === SessionState.Established) {
        stopRingback();
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
        answeredAtRef.current = Date.now();
        setCallStatus("Connected");
        answeredStatePromiseRef.current = reportProviderCallState(callRecordId, providerCallId, "answered");
        void answeredStatePromiseRef.current.catch((stateError: unknown) => {
          if (!endedRef.current) setError(stateError instanceof Error ? stateError.message : "The answered call could not be linked to its record.");
        });
        const handler = inviter.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
        if (audioRef.current && handler) {
          audioRef.current.srcObject = handler.remoteMediaStream;
          void audioRef.current.play().catch(() => setError("Call connected. Click the page once if you cannot hear remote audio."));
        }
      } else if (state === SessionState.Terminated && !endedRef.current) {
        stopRingback();
        if (answeredAtRef.current === null) {
          resultStatusRef.current ??= "Call ended before answer without a SIP rejection response";
          setCallStatus(resultStatusRef.current);
          setOutcome("not-picked");
        } else {
          resultStatusRef.current ??= "Call ended by remote party";
          setCallStatus("Call ended by remote party");
        }
        void endCallRef.current(false);
      }
    });
    await inviter.invite({ requestDelegate: {
      onProgress: () => {
        setCallStatus("Ringing");
        announceThenRingback(configuration);
        void reportProviderCallState(callRecordId, providerCallId, "ringing").catch((stateError: unknown) => {
          if (!endedRef.current) setError(stateError instanceof Error ? stateError.message : "The ringing call could not be linked to its record.");
        });
      },
      onReject: (response) => {
        const statusCode = response.message.statusCode;
        const reasonPhrase = response.message.reasonPhrase?.trim();
        const sipFailure = `Crazytel rejected the call (SIP ${statusCode ?? "unknown"}${reasonPhrase ? ` ${reasonPhrase}` : ""})`;
        if (statusCode === 486 || statusCode === 600) {
          resultStatusRef.current = `${sipFailure} — Busy`;
          setCallStatus(resultStatusRef.current);
          setOutcome("busy");
        } else if (statusCode === 603) {
          resultStatusRef.current = `${sipFailure} — Declined`;
          setCallStatus(resultStatusRef.current);
          setOutcome("not-picked");
        } else if (statusCode === 408) {
          resultStatusRef.current = `${sipFailure} — No answer`;
          setCallStatus(resultStatusRef.current);
          setOutcome("not-picked");
        } else if (statusCode === 480) {
          resultStatusRef.current = `${sipFailure} — Temporarily unavailable`;
          setCallStatus(resultStatusRef.current);
          setOutcome("not-picked");
        } else {
          resultStatusRef.current = sipFailure;
          setCallStatus(resultStatusRef.current);
          setOutcome("not-picked");
        }
      },
    } });
  }

  const connectInitialCall = useEffectEvent(async (configuration: TelephonyConfig, callRecordId: string) => {
    await connectAndDial(configuration, callRecordId);
  });

  useEffect(() => {
    if (!call || finishing) return;
    const interval = window.setInterval(() => {
      const answeredAt = answeredAtRef.current;
      const elapsed = answeredAt === null ? 0 : Math.floor((Date.now() - answeredAt) / 1000);
      setElapsedSeconds(Math.max(0, elapsed));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [call, finishing]);

  useEffect(() => {
    if (!initialCall || !telephony || userAgentRef.current) return;
    void connectInitialCall(telephony, initialCall.call.call_id).catch(async (connectError: unknown) => {
      const message = connectError instanceof Error ? connectError.message : "Crazytel WebRTC could not connect.";
      resultStatusRef.current = `Call setup failed: ${message}`;
      setError(message);
      await endCallRef.current(false);
    });
  }, [initialCall, telephony]);

  function formatDuration(totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  }

  async function startCall() {
    setBusy(true);
    setError("");
    setNotice("");
    let startedCall: StartedCall | null = null;
    try {
      unlockCallAudio();
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser does not support microphone calling.");
      setCallStatus("Requesting microphone access");
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      const started = await startManualCall(contactId);
      startedCall = started.call;
      setCall(started.call);
      setTelephony(started.telephony);
      endedRef.current = false;
      answeredAtRef.current = null;
      answeredStatePromiseRef.current = null;
      reportedProviderStateRef.current = null;
      resultStatusRef.current = null;
      recordingNoticeStartedRef.current = false;
      setOutcome("not-picked");
      setElapsedSeconds(0);
      await connectAndDial(started.telephony, started.call.call_id);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Call could not be started.");
      if (startedCall) {
        resultStatusRef.current = `Call setup failed: ${startError instanceof Error ? startError.message : "Crazytel WebRTC could not connect."}`;
        await stopTelephony();
        const response = await fetch("/api/calls/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end", callId: startedCall.call_id }),
        });
        const result = await response.json() as { result?: { ended_at?: string; manual_duration_seconds?: number } };
        if (response.ok && result.result?.ended_at) {
          const endedCall = { ...startedCall, ended_at: result.result.ended_at, manual_duration_seconds: result.result.manual_duration_seconds ?? 0 };
          endedRef.current = true;
          setCall(endedCall);
          setElapsedSeconds(endedCall.manual_duration_seconds ?? 0);
          setCallStatus(resultStatusRef.current);
          setFinishing(true);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function endCall() {
    return endCallRef.current(true);
  }

  async function finishServerCall(sendBye: boolean) {
    if (!call || endedRef.current) return;
    endedRef.current = true;
    resultStatusRef.current ??= answeredAtRef.current === null ? "Call ended before answer" : "Call ended";
    setBusy(true);
    setError("");
    try {
      await answeredStatePromiseRef.current?.catch(() => undefined);
      const inviter = inviterRef.current;
      if (sendBye && inviter) {
        try {
          if (inviter.state === SessionState.Established) await inviter.bye();
          else if (inviter.state === SessionState.Initial || inviter.state === SessionState.Establishing) await inviter.cancel();
        } catch (sipError) {
          console.error("Could not signal Crazytel to end the call; saving the local call record anyway.", sipError);
        }
      }
      setCallStatus("Saving call end");
      await stopTelephony();
      const result = await endManualCall(call.call_id);
      const finalSeconds = result.manual_duration_seconds;
      setElapsedSeconds(finalSeconds);
      setCall((current) => current ? { ...current, ended_at: result.ended_at, manual_duration_seconds: finalSeconds } : current);
      setCallStatus(resultStatusRef.current ?? "Call ended");
      setFinishing(true);
    } catch (endError) {
      endedRef.current = false;
      setError(endError instanceof Error ? endError.message : "Call could not be ended.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    endCallRef.current = finishServerCall;
  });

  useEffect(() => () => cleanupTelephonyOnUnmount(), []);

  async function finishCall(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!call) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/calls/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finish",
          callId: call.call_id,
          outcome,
          note,
          callbackAt: outcome === "call-later" ? new Date(callbackAt).toISOString() : "",
          timezone: outcome === "call-later" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "",
        }),
      });
      const result = await response.json() as { error?: string; ghlSync?: { status: "synced" | "not_configured" | "failed"; reason?: string } };
      if (!response.ok) throw new Error(result.error ?? "Call outcome could not be saved. Try again or contact your administrator.");
      const sync = result.ghlSync;
      const savedNotice = sync?.status === "synced"
        ? "Call result saved in the app and synced to GHL."
        : sync?.status === "failed"
          ? `Saved in the app, but the GHL update failed${sync.reason ? `: ${sync.reason}` : "."}`
          : `Saved in the app. ${sync?.reason ?? "Configure the GHL call fields to sync this result."}`;
      setNotice(savedNotice);
      setCall(null);
      setTelephony(null);
      setFinishing(false);
      await registererRef.current?.unregister().catch(() => undefined);
      await userAgentRef.current?.stop().catch(() => undefined);
      registererRef.current = null;
      inviterRef.current = null;
      userAgentRef.current = null;
      onCallSaved?.(savedNotice);
      router.refresh();
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : "Call outcome could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className={styles.callWorkflow}>
    {!call ? <><header><div><span className={styles.eyebrow}>CALLING</span><h3>Start a CRM call</h3></div></header>
    {error ? <p className={styles.workflowError} role="alert">{error}</p> : null}
    {notice ? <p className={styles.workflowSuccess} role="status">{notice}</p> : null}
    <Button onClick={() => void startCall()} disabled={busy}><PhoneCall size={15} /> {busy ? "Starting…" : "Start call"}</Button></> : finishing ? <div className={styles.modalBackdrop}>
        <form className={styles.dispositionForm} role="dialog" aria-modal="true" aria-labelledby="call-result-title" onSubmit={(event) => void finishCall(event)}>
          <header className={styles.dispositionHeader}><div><span className={styles.eyebrow}>{callStatus.toUpperCase()} · {formatDuration(elapsedSeconds)}</span><h2 id="call-result-title">Save call details</h2><p>{contactName}</p></div></header>
          <label>Call stage<select required value={outcome} onChange={(event) => setOutcome(event.target.value as CallStage)}><option value="picked">Picked</option><option value="not-picked">Not picked</option><option value="call-later">Call later</option><option value="busy">Busy</option><option value="interested">Interested</option></select></label>
          {outcome === "call-later" ? <label>Callback date and time<input type="datetime-local" required value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} /></label> : null}
          <label>Message / call notes<textarea rows={4} maxLength={5000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a message or call notes" /></label>
          {error ? <p className={styles.workflowError} role="alert">{error}</p> : null}
          <div className={styles.dispositionActions}><Button type="submit" disabled={busy || (outcome === "call-later" && !callbackAt)}>{busy ? "Saving…" : "Save call result"}</Button></div>
        </form>
      </div> : <div className={styles.modalBackdrop}><section className={styles.activeCallDialog} role="dialog" aria-modal="true" aria-labelledby="active-call-title">
        <audio ref={audioRef} autoPlay />
        <header className={styles.dispositionHeader}><div><span className={styles.eyebrow}>CRAZYTEL WEBRTC</span><h2 id="active-call-title">{callStatus}</h2><p>{contactName}</p></div><StatusBadge tone={callStatus === "Connected" ? "success" : "warning"}>{callStatus}</StatusBadge></header>
        <div className={styles.activeCallTimer}><Clock3 size={24} /><strong>{formatDuration(elapsedSeconds)}</strong></div>
        <p className={styles.workflowDisclosure}>The timer starts when the call is answered. Ringing time is not counted; verified CDR reconciliation is not yet enabled.</p>
        <label className={styles.liveNotes}>Call notes<textarea rows={4} maxLength={5000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add important details while you speak…" /><small>{note.length}/5000 · Notes stay here for the call result.</small></label>
        {error ? <p className={styles.workflowError} role="alert">{error}</p> : null}
        <Button variant="secondary" onClick={() => void endCall()} disabled={busy}><PhoneOff size={15} /> {busy ? "Ending…" : "End call"}</Button>
      </section></div>}
  </section>;
}
