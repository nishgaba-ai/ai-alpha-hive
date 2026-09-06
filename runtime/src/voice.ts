// Voice: speech-to-text and text-to-speech proxies. The browser console
// works with no configuration (Web Speech API); when a company stores
// provider keys in the vault these endpoints give better voices and
// transcription. Keys never reach the browser.
//
//   voice:
//     stt: browser | openai | deepgram
//     tts: browser | openai | elevenlabs
//     voice_id: alloy | <elevenlabs voice id>

import type { SecretResolver } from "./types.js";

export type VoiceConfig = { stt?: "browser" | "openai" | "deepgram"; tts?: "browser" | "openai" | "elevenlabs"; voice_id?: string };

export async function transcribe(cfg: VoiceConfig, secrets: SecretResolver, audio: Buffer, mime: string): Promise<{ text: string }> {
  if (cfg.stt === "deepgram") {
    const key = secrets.get("DEEPGRAM_API_KEY");
    if (!key) throw new Error("DEEPGRAM_API_KEY missing");
    const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", { method: "POST", headers: { Authorization: `Token ${key}`, "Content-Type": mime }, body: new Uint8Array(audio) });
    const body = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
    return { text: body.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "" };
  }
  if (cfg.stt === "openai") {
    const key = secrets.get("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY missing");
    const form = new FormData();
    form.set("model", "gpt-4o-transcribe");
    form.set("file", new Blob([new Uint8Array(audio)], { type: mime }), "audio.webm");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    const body = (await res.json()) as { text?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(body.error?.message ?? "transcription failed");
    return { text: body.text ?? "" };
  }
  throw new Error("server STT not configured; the browser transcribes locally");
}

export async function synthesize(cfg: VoiceConfig, secrets: SecretResolver, text: string): Promise<{ audio: Buffer; mime: string }> {
  if (cfg.tts === "elevenlabs") {
    const key = secrets.get("ELEVENLABS_API_KEY");
    if (!key) throw new Error("ELEVENLABS_API_KEY missing");
    const voice = cfg.voice_id ?? "21m00Tcm4TlvDq8ikWAM";
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
    });
    if (!res.ok) throw new Error(`elevenlabs: HTTP ${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  }
  if (cfg.tts === "openai") {
    const key = secrets.get("OPENAI_API_KEY");
    if (!key) throw new Error("OPENAI_API_KEY missing");
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: cfg.voice_id ?? "alloy", input: text, response_format: "mp3" }),
    });
    if (!res.ok) throw new Error(`openai tts: HTTP ${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  }
  throw new Error("server TTS not configured; the browser speaks locally");
}
