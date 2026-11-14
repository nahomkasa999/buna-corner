import { NextResponse } from "next/server";
import { getMenu, upsertMenuItem } from "@/lib/store";
import { isOwnerRequest, resolveUser } from "@/lib/telegram-auth";

export async function GET(req: Request) {
  const { user } = resolveUser(req);
  if (!isOwnerRequest(req, user)) return NextResponse.json({ ok: false, error: "Owner only" }, { status: 403 });
  return NextResponse.json({ ok: true, items: getMenu(true) });
}

export async function POST(req: Request) {
  const { user } = resolveUser(req);
  if (!isOwnerRequest(req, user)) return NextResponse.json({ ok: false, error: "Owner only" }, { status: 403 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const item = upsertMenuItem(body as Parameters<typeof upsertMenuItem>[0]);
  return NextResponse.json({ ok: true, item }, { status: 201 });
}
