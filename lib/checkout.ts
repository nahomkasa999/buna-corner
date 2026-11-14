// In-chat payment with Telegram Stars (XTR) — no web page, no card form.
//
// Flow: customer says "pay" (or taps Pay on an item widget) ->
//   sendCartInvoice()   snapshot the cart into an immutable draft and send a
//                       native Telegram invoice (sendInvoice, currency XTR)
//   validatePreCheckout() answer the pre_checkout_query (stock, amount, not paid)
//   completePayment()   on successful_payment create the order (idempotent)
//
// Menu prices are ETB; Stars are converted at ETB_PER_STAR (default 2.5 ETB
// per Star, rounded UP so the shop never under-charges). Telegram requires
// exactly ONE price line for XTR invoices, so the itemised order goes in the
// invoice description. Stars payments need no provider token.

import {
  checkStock,
  clearCart,
  createDraft,
  createOrder,
  decrementStock,
  getCart,
  getDraft,
  getOrders,
  getWidgetDraftId,
  learnFromOrder,
  type DraftOrder,
  type Order,
} from "./store";
import { tgCall } from "./tg";

export const DELIVERY_FEE = 50;

export function etbPerStar(): number {
  const v = Number(process.env.ETB_PER_STAR);
  return Number.isFinite(v) && v > 0 ? v : 2.5;
}

export function starsFor(etb: number): number {
  return Math.max(1, Math.ceil(etb / etbPerStar()));
}

export function draftTotals(d: Pick<DraftOrder, "lines" | "fulfillment">): { subtotal: number; deliveryFee: number; total: number } {
  const subtotal = d.lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);
  const deliveryFee = d.fulfillment === "delivery" ? DELIVERY_FEE : 0;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function describeLines(d: DraftOrder): string {
  const parts = d.lines.map((l) => {
    const size = l.options?.Size && l.options.Size !== "Small" ? ` (${l.options.Size})` : "";
    return `${l.qty}× ${l.name}${size}`;
  });
  const { total, deliveryFee } = draftTotals(d);
  const tail = `${deliveryFee ? ` + delivery ${deliveryFee}` : ""} = ${total} ETB`;
  const text = parts.join(", ") + tail;
  return text.length <= 250 ? text : text.slice(0, 247) + "…";
}

export type InvoiceResult =
  | { ok: true; draftId: string; stars: number; totalEtb: number }
  | { ok: false; reason: "empty" | "stock" | "need_address" | "telegram"; detail?: string };

/**
 * Send the customer's cart as a Stars invoice in their chat. The cart is
 * snapshotted first, so adding items afterwards can never change what an
 * already-sent invoice pays for.
 */
export async function sendCartInvoice(userId: number, chatId: number): Promise<InvoiceResult> {
  const cart = getCart(userId);
  if (!cart) return { ok: false, reason: "empty" };
  const stockError = checkStock(cart.lines.map((l) => ({ id: l.id, qty: l.qty })));
  if (stockError) return { ok: false, reason: "stock", detail: stockError };
  if (cart.fulfillment === "delivery" && !cart.address) return { ok: false, reason: "need_address" };

  const totalEtb = draftTotals(cart).total;
  const stars = starsFor(totalEtb);
  const snap = createDraft(userId, cart.lines.map((l) => ({ ...l, options: { ...(l.options ?? {}) } })), cart.fulfillment);
  snap.address = cart.address;
  snap.invoiceStars = stars;

  const r = await tgCall("sendInvoice", {
    chat_id: chatId,
    title: "Buna Corner",
    description: describeLines(snap),
    payload: snap.id,
    currency: "XTR",
    prices: [{ label: `Order · ${totalEtb} ETB`, amount: stars }],
  });
  if (!r.ok) return { ok: false, reason: "telegram", detail: r.reason };
  return { ok: true, draftId: snap.id, stars, totalEtb };
}

export interface PreCheckout {
  id?: string;
  from?: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

/** Decide a pre_checkout_query. Must be answered within 10 s by the caller. */
export function validatePreCheckout(q: PreCheckout): { ok: true } | { ok: false; message: string } {
  const d = getDraft(q.invoice_payload);
  if (!d) return { ok: false, message: "This order expired — please ask me to send a new one." };
  if (d.paidChargeId) return { ok: false, message: "This order is already paid." };
  if (q.currency !== "XTR" || d.invoiceStars !== q.total_amount) {
    return { ok: false, message: "The amount changed — please ask me for a fresh invoice." };
  }
  const stockError = checkStock(d.lines.map((l) => ({ id: l.id, qty: l.qty })));
  if (stockError) return { ok: false, message: `${stockError} — sorry! Tell me what else you'd like.` };
  return { ok: true };
}

export interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
}

/**
 * successful_payment -> paid order. Idempotent on the Telegram charge id
 * (Telegram may redeliver the update). The money is already taken at this
 * point, so an order is created even if something looks off.
 */
export function completePayment(
  user: { id: number; first_name: string },
  p: SuccessfulPayment,
): { ok: true; order: Order; duplicate: boolean } | { ok: false; reason: string } {
  const d = getDraft(p.invoice_payload);
  if (!d) return { ok: false, reason: "unknown draft" };
  if (d.paidChargeId && d.orderId) {
    const existing = getOrders().find((o) => o.id === d.orderId);
    if (existing) return { ok: true, order: existing, duplicate: true };
  }
  const order = createOrder({
    user,
    lines: d.lines,
    fulfillment: d.fulfillment,
    address: d.address,
    paymentMethod: "stars",
  });
  order.chargeId = p.telegram_payment_charge_id;
  order.paymentStatus = "paid";
  d.paidChargeId = p.telegram_payment_charge_id;
  d.orderId = order.id;
  try { decrementStock(d.lines.map((l) => ({ id: l.id, qty: l.qty }))); } catch { /* never fail a paid order */ }
  learnFromOrder(order);
  // Clear the open cart only if it still holds exactly what was just paid for;
  // items added after the invoice was sent stay in the cart.
  const cart = getCart(user.id);
  if (getWidgetDraftId(user.id) && cart && JSON.stringify(cart.lines) === JSON.stringify(d.lines)) clearCart(user.id);
  return { ok: true, order, duplicate: false };
}
