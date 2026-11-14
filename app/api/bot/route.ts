import { NextResponse } from "next/server";
import { webhookCallback } from "grammy";
import { createBot } from "@/bot/bot";

export async function POST(req: Request) {
  const bot = createBot();
  if (!bot) {
    return NextResponse.json({ ok: false, error: "BOT_TOKEN not configured" }, { status: 503 });
  }
  const handler = webhookCallback(bot, "std/http");
  return handler(req as unknown as Parameters<typeof handler>[0]);
}

export async function GET() {
  return NextResponse.json({ ok: !!process.env.BOT_TOKEN, webhook: "/api/bot" });
}
