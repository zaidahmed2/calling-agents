import { afterEach, describe, expect, it, vi } from "vitest";

import { synthesizeGeminiTts } from "./gemini-tts";

function wavBase64() {
  const wav = Buffer.alloc(48);
  wav.write("RIFF", 0, "ascii");
  wav.write("WAVE", 8, "ascii");
  return wav.toString("base64");
}

afterEach(() => vi.unstubAllGlobals());

describe("Gemini TTS", () => {
  it("requests WAV audio with a feminine prebuilt voice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_audio: { data: wavBase64() },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(synthesizeGeminiTts("Welcome to our service.", "server-key")).resolves.toBe(wavBase64());
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.headers).toEqual({ "Content-Type": "application/json", "x-goog-api-key": "server-key" });
    const body = JSON.parse(String(options.body)) as { model: string; generation_config: { speech_config: Array<{ voice: string }> } };
    expect(body.model).toBe("gemini-3.8-flash-tts");
    expect(body.generation_config.speech_config[0].voice).toBe("Kore");
  });

  it("reads audio from the REST steps response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      steps: [{ content: [{ type: "audio", data: wavBase64() }] }],
    }), { status: 200 })));

    await expect(synthesizeGeminiTts("Hello.", "server-key")).resolves.toBe(wavBase64());
  });

  it("rejects unsuccessful and malformed audio responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
    await expect(synthesizeGeminiTts("Hello.", "server-key")).rejects.toThrow("HTTP 429");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output_audio: { data: Buffer.from("not a wav").toString("base64") },
    }), { status: 200 })));
    await expect(synthesizeGeminiTts("Hello.", "server-key")).rejects.toThrow("invalid or oversized WAV");
  });
});
