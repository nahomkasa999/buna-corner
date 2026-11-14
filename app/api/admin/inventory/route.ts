import { NextResponse } from "next/server";
import { getInventory, setStock } from "@/lib/store";
import { isOwnerRequest, resolveUser } from "@/lib/telegram-auth";

/** PATCH /api/admin/inventory {itemId, qty} — owner only. Restock / set quantity. */
export async function PATCH(req: Request) {
  const { user } = resolveUser(req);
  if (!isOwnerRequest(req, user)) return NextResponse.json({ ok: false, error: "Owner only" }, { status: 403 });
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const qty = Number(body.qty);
  if (!itemId) return NextResponse.json({ ok: false, error: "itemId is required" }, { status: 400 });
  if (!Number.isFinite(qty) || qty < 0) return NextResponse.json({ ok: false, error: "qty must be a number >= 0" }, { status: 400 });
  const stock = setStock(itemId, qty);
  if (!stock) return NextResponse.json({ ok: false, error: `Unknown item: ${itemId}` }, { status: 404 });
  return NextResponse.json({ ok: true, itemId, stock, inventory: getInventory() });
}
