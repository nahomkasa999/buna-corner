import { NextResponse } from "next/server";
import { createSubscription, getSubscription } from "@/lib/store";
import { SUBSCRIPTION_PLAN } from "@/lib/data";
import { resolveUser } from "@/lib/telegram-auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { user } = resolveUser(req);
  const userId = Number(url.searchParams.get("userId") ?? user.id);
  return NextResponse.json({ ok: true, plan: SUBSCRIPTION_PLAN, subscription: getSubscription(userId) ?? null });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { user } = resolveUser(req, typeof body.initData === "string" ? body.initData : null);
  const method = body.method === "stars" ? "stars" : "mock";
  // NOTE: real Telegram Stars subscriptions need a bot with Stars + invoice flow;
  // here Stars is recorded as a mock subscription (see LIMITATIONS.md).
  const subscription = createSubscription(user.id, method);
  return NextResponse.json({ ok: true, plan: SUBSCRIPTION_PLAN, subscription }, { status: 201 });
}
