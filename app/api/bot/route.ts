import { NextResponse } from "next/server";
import { webhookCallback } from "grammy";
import { createBot } from "@/bot/bot";
import { handleWidgetQuery, isWidgetQuery } from "@/lib/widget";

export async function POST(req: Request) {
  // Bot API 10.4 widget_query updates are NOT dispatched by grammY, so
  // intercept them here first. req.clone() leaves the original request
  // untouched for the grammY webhook handler below.
  let body: unknown = null;
  try {
    body = await req.clone().json();
  } catch {
    // Not JSON — let grammY handle (or reject) it.
  }
  if (isWidgetQuery(body)) {
    // handleWidgetQuery answers every query (within 15 s, also on failure)
    // and never throws.
    await handleWidgetQuery(body.widget_query);
    return NextResponse.json({ ok: true, widget_query: true });
  }
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
