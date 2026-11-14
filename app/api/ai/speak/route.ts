import { NextResponse } from "next/server";
import { detectLang, speakText, type AiLang } from "@/lib/ai";

/** POST /api/ai/speak {text, lang?} -> TTS audio (base64). Mock mode returns audioBase64 null. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });
    const lang: AiLang = body.lang === "en" || body.lang === "am" ? body.lang : detectLang(text);
    const audio = await speakText(text, lang);
    return NextResponse.json({ ok: true, ...audio, lang });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "TTS failed" }, { status: 500 });
  }
}
