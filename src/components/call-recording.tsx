"use client";

import { useEffect, useState } from "react";

type RecordingResult = { available?: boolean; streamUrl?: string; error?: string };

export function CallRecording({ callId }: { callId: string }) {
  const [result, setResult] = useState<RecordingResult | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/calls/${encodeURIComponent(callId)}/recording`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as RecordingResult;
        if (!response.ok) throw new Error(body.error ?? "Recording unavailable.");
        return body;
      })
      .then((body) => { if (active) setResult(body); })
      .catch((error: unknown) => { if (active) setResult({ error: error instanceof Error ? error.message : "Recording unavailable." }); });
    return () => { active = false; };
  }, [callId]);

  if (!result) return <small>Checking recording…</small>;
  if (!result.available || !result.streamUrl) return <small>{result.error ?? "No recording"}</small>;
  return <audio controls preload="none" src={result.streamUrl}>Your browser does not support audio playback.</audio>;
}
