import { NextResponse } from "next/server";
import { describeItem } from "@/lib/ai";

/** POST /api/ai/describe {itemId, lang?} -> spoken-style description + TTS audio. */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    const lang = typeof body.lang === "string" ? body.lang : undefined;
    if (!itemId) return NextResponse.json({ ok: false, error: "itemId is required" }, { status: 400 });
    const result = await describeItem(itemId, lang);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Describe failed" }, { status: 500 });
  }
}
