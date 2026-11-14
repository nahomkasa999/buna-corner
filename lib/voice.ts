// Voice notes in the bot chat.
//
// Out: Gemini TTS returns raw 16-bit PCM (or WAV); Telegram's sendVoice takes
// OGG/Opus, MP3 or M4A. There is no ffmpeg on Vercel, so the PCM is encoded
// to MP3 in pure JS (lamejs) and sent as a voice note.
// In:  a customer's voice note (OGG/Opus) is transcribed by Gemini, then
// handled like a typed message — and answered with a voice note.
// Everything returns null on failure (mock mode, no key, errors): the bot then
// simply answers in text.

import { aiConfigured, CHAT_FALLBACK_MODEL, CHAT_MODEL, getClient, speakText, type AiLang } from "./ai";

/** Sample rate from a Gemini audio mime type like "audio/L16;codec=pcm;rate=24000". */
export function rateFromMime(mime: string | null | undefined): number {
  const m = /rate=(\d+)/.exec(mime ?? "");
  return m ? Number(m[1]) : 24000;
}

/** Mono 16-bit little-endian PCM (or a WAV file) -> MP3. */
export async function pcmToMp3(audio: Buffer, mime?: string | null): Promise<Buffer> {
  // ESM-only package: a dynamic import works from both Next.js and the tsx test runner.
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  let pcm = audio;
  let rate = rateFromMime(mime);
  if (audio.subarray(0, 4).toString("ascii") === "RIFF" && audio.length > 44) {
    rate = audio.readUInt32LE(24);
    pcm = audio.subarray(44);
  }
  const even = pcm.length - (pcm.length % 2);
  const samples = new Int16Array(even / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2);
  const enc = new Mp3Encoder(1, rate, 64);
  const parts: Uint8Array[] = [];
  for (let i = 0; i < samples.length; i += 1152) {
    const chunk = enc.encodeBuffer(samples.subarray(i, i + 1152));
    if (chunk.length) parts.push(chunk);
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail);
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

/** Text -> MP3 voice note, or null (no key / TTS failed). */
export async function ttsMp3(text: string, lang: AiLang): Promise<Buffer | null> {
  if (!aiConfigured()) return null;
  try {
    const r = await speakText(text, lang);
    if (!r.audioBase64) return null;
    const mp3 = await pcmToMp3(Buffer.from(r.audioBase64, "base64"), r.mimeType);
    return mp3.length > 0 ? mp3 : null;
  } catch {
    return null;
  }
}

/** A customer's voice note -> text (Amharic in Ge'ez script), or null. */
export async function transcribe(audio: Buffer, mime = "audio/ogg"): Promise<string | null> {
  const ai = getClient();
  if (!ai) return null;
  for (const model of [CHAT_MODEL, CHAT_FALLBACK_MODEL]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: mime.split(";")[0] || "audio/ogg", data: audio.toString("base64") } },
            { text: "Transcribe this voice message from a coffee-shop customer exactly as spoken. Amharic must be written in Ge'ez script; English stays English. Reply with the transcript only." },
          ],
        }],
        config: { maxOutputTokens: 300, temperature: 0 },
      });
      const t = res.text?.trim();
      if (t) return t;
    } catch {
      // try the next model
    }
  }
  return null;
}
