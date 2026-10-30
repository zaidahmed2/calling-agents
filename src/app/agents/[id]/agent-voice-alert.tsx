"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Play, Volume2 } from "lucide-react";

import styles from "@/app/agents/[id]/agent-detail.module.css";

type Settings = { enabled: boolean; text: string };

export default function AgentVoiceAlert({ agentId }: { agentId: string }) {
  const [settings, setSettings] = useState<Settings>({ enabled: false, text: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/voice-alert`, { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { settings?: Settings; error?: string };
        if (!response.ok || !result.settings) throw new Error(result.error ?? "Voice Alert settings could not be loaded.");
        if (active) setSettings(result.settings);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Voice Alert settings could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [agentId]);

  async function saveSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/voice-alert`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Voice Alert settings could not be saved.");
      setNotice("Voice Alert settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Voice Alert settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function generatePreview() {
    setPreviewing(true);
    setError("");
    setNotice("");
    if (audioRef.current) audioRef.current.pause();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    try {
      const response = await fetch(`/api/admin/agents/${encodeURIComponent(agentId)}/voice-alert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: settings.text }),
      });
      const result = await response.json() as { audio?: string; error?: string };
      if (!response.ok || !result.audio) throw new Error(result.error ?? "Voice Alert preview could not be generated.");
      const binary = window.atob(result.audio);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      setPreviewUrl(url);
      setNotice("Preview is ready. Press Play to listen.");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Voice Alert preview could not be generated.");
    } finally {
      setPreviewing(false);
    }
  }

  async function playPreview() {
    try {
      await audioRef.current?.play();
    } catch {
      setError("Preview playback was blocked by the browser. Press Play again to listen.");
    }
  }

  return <section className={styles.visibilityPanel}>
    <header>
      <span className={styles.visibilityIcon}><Volume2 size={16} /></span>
      <div><h2>Voice Alert</h2><p>Play a configured announcement to the customer after they answer this agent’s call.</p></div>
    </header>
    {loading ? <p className={styles.visibilityMessage}>Loading Voice Alert settings…</p> : <form className={styles.voiceAlertForm} onSubmit={(event) => void saveSettings(event)}>
      <label className={styles.voiceAlertToggle}>
        <input type="checkbox" checked={settings.enabled} onChange={(event) => {
          if (!event.target.checked) {
            if (audioRef.current) audioRef.current.pause();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl("");
          }
          setSettings((current) => ({ ...current, enabled: event.target.checked }));
        }} />
        <span><strong>Enable Voice Alert</strong><small>Disabled agents keep the existing call flow.</small></span>
      </label>
      {settings.enabled ? <label className={styles.voiceAlertText}>
        <span>Announcement text</span>
        <textarea required maxLength={1000} rows={4} value={settings.text} onChange={(event) => {
          if (audioRef.current) audioRef.current.pause();
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setPreviewUrl("");
          setSettings((current) => ({ ...current, text: event.target.value }));
        }} placeholder="Enter the message the customer will hear after answering." />
        <small>{settings.text.length}/1000 characters. Generated with Gemini TTS.</small>
      </label> : null}
      {settings.enabled ? <div className={styles.voiceAlertPreview}>
        <button type="button" onClick={() => void generatePreview()} disabled={previewing || !settings.text.trim()}><Volume2 size={14} />{previewing ? "Generating preview…" : "Generate preview"}</button>
        {previewUrl ? <><audio ref={audioRef} src={previewUrl} preload="auto" /><button type="button" className={styles.voiceAlertPlay} onClick={() => void playPreview()}><Play size={13} />Play</button></> : null}
      </div> : null}
      {error ? <p className={styles.visibilityError} role="alert">{error}</p> : null}
      {notice ? <p className={styles.visibilityNotice} role="status">{notice}</p> : null}
      <footer><small>Settings apply only to this agent.</small><button type="submit" disabled={saving}>{saving ? "Saving…" : <><Check size={14} /> Save Voice Alert</>}</button></footer>
    </form>}
  </section>;
}
