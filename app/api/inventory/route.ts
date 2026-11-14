import { NextResponse } from "next/server";
import { getInventory } from "@/lib/store";
import { isOwnerRequest, resolveUser } from "@/lib/telegram-auth";

/** GET /api/inventory — owner only. Live stock for every menu item. */
export async function GET(req: Request) {
  const { user } = resolveUser(req);
  if (!isOwnerRequest(req, user)) return NextResponse.json({ ok: false, error: "Owner only" }, { status: 403 });
  return NextResponse.json({ ok: true, inventory: getInventory() });
}
