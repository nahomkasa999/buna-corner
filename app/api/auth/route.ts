import { NextResponse } from "next/server";
import { DEMO_USER, resolveUser, validateInitData } from "@/lib/telegram-auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const initData = typeof body.initData === "string" ? body.initData : "";
  const token = process.env.BOT_TOKEN || "";
  if (initData && token) {
    const r = validateInitData(initData, token);
    if (r.valid && r.user) return NextResponse.json({ ok: true, validated: true, user: r.user });
    return NextResponse.json({ ok: false, validated: false, error: r.error, user: DEMO_USER, demo: true });
  }
  const { user } = resolveUser(req, initData);
  return NextResponse.json({ ok: true, validated: false, demo: true, user });
}
