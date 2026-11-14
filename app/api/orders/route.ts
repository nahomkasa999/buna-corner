import { NextResponse } from "next/server";
import { checkStock, createOrder, decrementStock, getMenuItem, getOrders, learnFromOrder, type OrderLine, type PaymentMethod } from "@/lib/store";
import { isOwnerRequest, resolveUser } from "@/lib/telegram-auth";
import { notifyOwnerNewOrder } from "@/bot/bot";
import { sendOrderTrackerWidget } from "@/lib/widget";

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
  // Stock check on the RAW requested quantities first — before the per-line
  // qty clamp below — so an over-order (e.g. 99 croissants when 25 are left)
  // is rejected with the amount left instead of silently shrinking.
  const rawStockError = checkStock(
    rawItems.map((r: { id: string; qty: number }) => ({ id: String(r.id), qty: Number(r.qty) || 1 })),
  );
  if (rawStockError) return NextResponse.json({ ok: false, error: rawStockError }, { status: 400 });
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
  // Stock check first — reject the whole order if any line exceeds what's left.
  const stockError = checkStock(lines.map((l) => ({ id: l.id, qty: l.qty })));
  if (stockError) return NextResponse.json({ ok: false, error: stockError }, { status: 400 });
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
  // Sale decrements stock (soldOut flips at 0) and teaches the AI barista
  // the customer's favourites. Neither may fail the order.
  try { decrementStock(lines.map((l) => ({ id: l.id, qty: l.qty }))); } catch { /* ignore */ }
  learnFromOrder(order);
  // Fire-and-forget owner notification — never fail the order on notify error.
  notifyOwnerNewOrder(order.id).catch(() => undefined);
  // Send the interactive order-tracker widget (Bot API 10.4) to the customer
  // in the bot chat — no-op without BOT_TOKEN or if they never started the bot.
  sendOrderTrackerWidget(order.id).catch(() => undefined);
  const mockPayCode = paymentMethod === "stars" ? undefined : `BC-${order.id.slice(3)}-${Math.floor(1000 + Math.random() * 9000)}`;
  return NextResponse.json({ ok: true, order, mockPayCode, stampsEarned: order.stampsEarned }, { status: 201 });
}
