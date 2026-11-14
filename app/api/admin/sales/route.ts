import { NextResponse } from "next/server";
import { dailySales } from "@/lib/store";
import { isOwnerRequest, resolveUser } from "@/lib/telegram-auth";

export async function GET(req: Request) {
  const { user } = resolveUser(req);
  if (!isOwnerRequest(req, user)) return NextResponse.json({ ok: false, error: "Owner only" }, { status: 403 });
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  return NextResponse.json({ ok: true, ...dailySales(date) });
}
