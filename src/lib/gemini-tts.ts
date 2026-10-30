const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";

function findAudioData(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const outputAudio = root.output_audio;
  if (outputAudio && typeof outputAudio === "object" && !Array.isArray(outputAudio)) {
    const data = (outputAudio as Record<string, unknown>).data;
    if (typeof data === "string") return data;
  }
  if (!Array.isArray(root.steps)) return null;
  for (const step of root.steps) {
    if (!step || typeof step !== "object" || Array.isArray(step)) continue;
    const content = (step as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const audioPart = part as Record<string, unknown>;
      if (audioPart.type === "audio" && typeof audioPart.data === "string") return audioPart.data;
    }
  }
  return null;
}

export async function synthesizeGeminiTts(text: string, apiKey: string): Promise<string> {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: GEMINI_TTS_MODEL,
      input: [{
        type: "user_input",
        content: [{
          type: "text",
          text,
          annotations: [{ type: "speech_metadata", style: "Clear, natural, friendly feminine voice." }],
        }],
      }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: "Kore" }] },
    }),
  });
  if (!response.ok) throw new Error(`Gemini TTS request failed (HTTP ${response.status}).`);

  const audioData = findAudioData(await response.json());
  if (!audioData || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioData)) {
    throw new Error("Gemini TTS returned no valid audio.");
  }
  const audio = Buffer.from(audioData, "base64");
  if (audio.length < 44 || audio.length > 8 * 1024 * 1024 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Gemini TTS returned an invalid or oversized WAV file.");
  }
  return audio.toString("base64");
}
