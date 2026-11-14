import { NextResponse } from "next/server";
import { chatWithMemory, greetUser, speakText } from "@/lib/ai";
import { resolveUser } from "@/lib/telegram-auth";

/**
 * POST /api/ai/chat {message?, userId?, lang?, voice?, greet?}
 * Amharic-first AI barista chat with per-user memory. Works in mock mode
 * (no GEMINI_API_KEY) — canned Amharic reply, no audio, never crashes.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { user } = resolveUser(req);
    const userId = typeof body.userId === "number" ? body.userId : user.id;
    const userName = typeof body.userName === "string" ? body.userName : user.first_name;
    const lang = typeof body.lang === "string" ? body.lang : undefined;
    const wantVoice = body.voice === true;

    let result;
    if (body.greet === true) {
      result = await greetUser(userId, userName, lang);
    } else {
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
      result = await chatWithMemory(userId, userName, message, lang);
    }

    let audioBase64: string | null = null;
    let audioMime: string | null = null;
    if (wantVoice) {
      const audio = await speakText(result.reply, result.lang);
      audioBase64 = audio.audioBase64;
      audioMime = audio.mimeType;
    }
    return NextResponse.json({ ok: true, ...result, audioBase64, audioMime });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "AI chat failed" }, { status: 500 });
  }
}
