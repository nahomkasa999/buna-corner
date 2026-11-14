import { NextResponse } from "next/server";
import { postItemToChannel } from "@/bot/bot";
import { isOwnerRequest, resolveUser } from "@/lib/telegram-auth";

export async function POST(req: Request) {
  const { user } = resolveUser(req);
  if (!isOwnerRequest(req, user)) return NextResponse.json({ ok: false, error: "Owner only" }, { status: 403 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const itemId = String(body.itemId ?? "");
  const channelId = typeof body.channelId === "string" ? body.channelId : undefined;
  if (!itemId) return NextResponse.json({ ok: false, error: "itemId required" }, { status: 400 });
  const result = await postItemToChannel(itemId, channelId);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
