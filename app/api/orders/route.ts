import { NextResponse } from "next/server";
import { createOrder, getMenuItem, getOrders, type OrderLine, type PaymentMethod } from "@/lib/store";
import { isOwnerRequest, resolveUser } from "@/lib/telegram-auth";
import { notifyOwnerNewOrder } from "@/bot/bot";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userIdParam = url.searchParams.get("userId");
  const { user } = resolveUser(req);
  const isOwner = isOwnerRequest(req, user);
  // Owner (or demoOwner) sees all orders; customers see only their own.
  const userId = isOwner && !userIdParam ? undefined : Number(userIdParam ?? user.id);
  return NextResponse.json({ ok: true, orders: getOrders(userId) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const { user } = resolveUser(req, typeof body.initData === "string" ? body.initData : null);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return NextResponse.json({ ok: false, error: "Cart is empty" }, { status: 400 });
  }
  const lines: OrderLine[] = [];
  for (const raw of rawItems as { id: string; qty: number; options?: Record<string, string> }[]) {
    const menuItem = getMenuItem(raw.id);
    if (!menuItem) return NextResponse.json({ ok: false, error: `Unknown item: ${raw.id}` }, { status: 400 });
    if (menuItem.soldOut) return NextResponse.json({ ok: false, error: `${menuItem.name} is sold out` }, { status: 400 });
    const qty = Math.max(1, Math.min(20, Number(raw.qty) || 1));
    let unitPrice = menuItem.price;
    const options = raw.options ?? {};
    for (const group of menuItem.options ?? []) {
      const choice = group.choices.find((c) => c.label === options[group.name]);
      if (choice) unitPrice += choice.priceDelta;
    }
    lines.push({ id: menuItem.id, name: menuItem.name, qty, unitPrice, options, image: menuItem.image });
  }
  const fulfillment = body.fulfillment === "delivery" ? "delivery" : "pickup";
  if (fulfillment === "delivery" && typeof body.address !== "string") {
    // Address is optional in demo (location share may come later) — do not block.
  }
  const paymentMethod = (["telebirr", "chapa", "stars"].includes(String(body.paymentMethod)) ? body.paymentMethod : "telebirr") as PaymentMethod;
  const order = createOrder({
    user,
    lines,
    fulfillment,
    address: typeof body.address === "string" ? body.address : undefined,
    notes: typeof body.notes === "string" ? body.notes : undefined,
    tip: Number(body.tip) || 0,
    paymentMethod,
    referralCode: typeof body.referralCode === "string" ? body.referralCode : undefined,
  });
  // Fire-and-forget owner notification — never fail the order on notify error.
  notifyOwnerNewOrder(order.id).catch(() => undefined);
  const mockPayCode = paymentMethod === "stars" ? undefined : `BC-${order.id.slice(3)}-${Math.floor(1000 + Math.random() * 9000)}`;
  return NextResponse.json({ ok: true, order, mockPayCode, stampsEarned: order.stampsEarned }, { status: 201 });
}
