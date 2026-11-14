// Telegram Bot API 10.4 HTML widgets — interactive cards inside the bot chat.
//
// A widget is ONE self-contained HTML document (inline CSS+JS, no network,
// no external images) sent with sendWidget. Limits: 32,768 bytes raw,
// 4,096 bytes after zlib level-9 compression, chat_data <= 1,024 bytes,
// widget request data 1-64 bytes, bot answer <= 1,024 bytes within 15 s.
// Production: private chats with the bot only; sent widgets are protected
// content (cannot be forwarded). Groups/inline/forwards are test-server only.
//
// grammY does not know sendWidget / widget_query yet, so everything here
// uses raw Bot API calls (lib/tg.ts), and the webhook route intercepts
// update.widget_query BEFORE the grammY dispatcher (grammY would drop the
// unknown update type). Every function is no-throw when BOT_TOKEN is unset.
//
// Widget JS API (verified against Telegram's widgets guide, Nov 2026):
//   window.TelegramWidget.request(data) -> Promise<{result?: string}>
//     (must be called synchronously inside a tap handler)
//   window.TelegramWidget.chatData -> JSON string of chat_data
//   window.TelegramWidget.onEvent('chatDataChanged', fn) -> redraw on edit
// The widget cannot change its own state: it asks, the bot edits chat_data
// with editMessageWidgetData and answers with answerWidgetQuery.

import { deflateSync } from "node:zlib";
import {
  addToWidgetDraft,
  getCart,
  getCartWidget,
  setCartWidget,
  getDraft,
  getMenuItem,
  getOrder,
  getWidgetDraftId,
  getWidgetState,
  setOrderTrackerWidget,
  setWidgetState,
  stockLeft,
  type Order,
  type OrderLine,
} from "./store";
import type { MenuItem } from "./data";
import { draftTotals, sendCartInvoice } from "./checkout";
import { deleteMessage, tgCall, type TgResult } from "./tg";

// ---------- size helpers ----------

export const SIZE_DELTA: Record<string, number> = { S: 0, M: 30, L: 60 };
export const SIZE_LABEL: Record<string, string> = { S: "Small", M: "Medium", L: "Large" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Raw + zlib level-9 compressed byte size of a widget HTML document. */
export function widgetSizes(html: string): { raw: number; compressed: number } {
  const raw = Buffer.byteLength(html, "utf8");
  const compressed = deflateSync(Buffer.from(html, "utf8"), { level: 9 }).length;
  return { raw, compressed };
}

export function widgetWithinLimits(html: string): boolean {
  const { raw, compressed } = widgetSizes(html);
  return raw <= 32768 && compressed <= 4096;
}

// ---------- widget HTML builders ----------

/**
 * Item card: name, price, stock line, size buttons (only when the item has
 * a Size option group), Add to cart, Pay now. State in chat_data:
 * {i, p, s, q, a} = itemId, base price, size code, qty in draft, added flag.
 */
export function buildItemWidget(item: MenuItem, stock: number): string {
  const hasSize = item.options?.some((g) => g.name === "Size");
  const stockLine = stock <= 0 ? "Sold out today" : `${stock} left`;
  const sizeRow = hasSize
    ? `<div class=r><button id=bS onclick="sz('S')">S</button><button id=bM onclick="sz('M')">M +30</button><button id=bL onclick="sz('L')">L +60</button></div>`
    : "";
  return `<style>body{margin:0;font:14px sans-serif}h3{margin:0 0 2px;font-size:15px}.p{color:var(--tg-theme-hint-color,#888);font-size:12px}.r{display:flex;gap:6px;margin:8px 0}button{flex:1;padding:8px 2px;border:0;border-radius:10px;background:var(--tg-theme-secondary-bg-color,#eee);font-size:13px}button.on{background:#c08a3e;color:#fff}.a{width:100%;padding:10px;border:0;border-radius:12px;background:#c08a3e;color:#fff;font-size:15px;font-weight:700;margin:4px 0}.c{width:100%;padding:9px;border:1px solid #c08a3e;border-radius:12px;background:none;color:#c08a3e;font-size:14px}#m{font-size:12px;min-height:15px;color:var(--tg-theme-hint-color,#888)}</style>`
    + `<div><h3>☕ ${esc(item.name)}</h3><div class=p>${esc(item.amharicName)} · ${item.category}</div>`
    + `<div><b id=pr>${item.price} ETB</b> · ${stockLine}</div>${sizeRow}`
    + `<button class=a id=ad onclick="ad()">➕ Add to cart</button>`
    + `<button class=c onclick="q('checkout')">💳 Pay now</button><div id=m>&nbsp;</div></div>`
    + `<script>var W=window.TelegramWidget,P=${item.price},SZ='S',QA=0,QN=0,I='${item.id}';`
    + `function st(){var c=W.chatData;if(c&&typeof c==='object')return c;try{return JSON.parse(c||'{}')}catch(e){return{}}}`
    + `function draw(s){SZ=s.s||'S';QA=s.a||0;QN=s.q||0;var d=SZ==='M'?30:SZ==='L'?60:0;var e=document.getElementById('pr');if(e)e.textContent=(P+d)+' ETB';['S','M','L'].forEach(function(x){var b=document.getElementById('b'+x);if(b)b.className=SZ===x?'on':''});var a=document.getElementById('ad');if(a)a.textContent=QA?('✅ Added ('+QN+') — add another'):'➕ Add to cart';var m=document.getElementById('m');if(m)m.textContent=s.err||' ';}`
    + `function q(x){if(!W)return;W.request(x).then(function(a){if(a&&a.result){try{draw(JSON.parse(a.result))}catch(e){}}}).catch(function(){})}`
    + `function sz(x){SZ=x;draw({s:x,a:QA,q:QN});q('size:'+I+':'+x)}`
    + `function ad(){q('add:'+I+':'+SZ)}`
    + `if(W){W.onEvent('chatDataChanged',function(){draw(st())});draw(st())}</script>`;
}

/**
 * Order tracker card: order id, items, total, status timeline, Refresh.
 * chat_data: {o, s} = orderId, status. Steps: Received → Brewing →
 * Ready (incl. "Out for delivery") → Completed; Cancelled shown separately.
 */
export function buildOrderWidget(order: Order): string {
  const items = order.lines.map((l) => `${l.qty}× ${l.name}`).join(", ");
  return `<style>body{margin:0;font:14px sans-serif}h3{margin:0 0 2px;font-size:15px}.p{color:var(--tg-theme-hint-color,#888);font-size:12px}.st div{padding:2px 0}.a{width:100%;padding:10px;border:0;border-radius:12px;background:#c08a3e;color:#fff;font-size:15px;font-weight:700;margin:8px 0 4px}#m{font-size:12px;min-height:15px;color:var(--tg-theme-hint-color,#888)}</style>`
    + `<div><h3>🧾 Order ${esc(order.id)}</h3><div class=p>${esc(items)}</div>`
    + `<div class=st id=st></div>`
    + `<div>Total: <b>${order.total} ETB</b> · ${order.fulfillment === "delivery" ? "Delivery" : "Pickup"}</div>`
    + `<button class=a onclick="q('refresh:${order.id}')">🔄 Refresh</button><div id=m>&nbsp;</div></div>`
    + `<script>var W=window.TelegramWidget;var ST=["Received","Brewing","Ready","Completed"];`
    + `function st(){var c=W.chatData;if(c&&typeof c==='object')return c;try{return JSON.parse(c||'{}')}catch(e){return{}}}`
    + `function draw(s){var c=s.s||"Received";var h="";if(c==="Cancelled"){h="<div>❌ Cancelled</div>"}else{var ix=c==="Out for delivery"?2:ST.indexOf(c);if(ix<0)ix=0;ST.forEach(function(x,i){h+="<div>"+(i<ix?"✅":i===ix?"☕":"○")+" "+x+"</div>"})}var e=document.getElementById('st');if(e)e.innerHTML=h;}`
    + `function q(x){if(!W)return;W.request(x).then(function(a){if(a&&a.result){try{draw(JSON.parse(a.result))}catch(e){}}}).catch(function(){})}`
    + `if(W){W.onEvent('chatDataChanged',function(){draw(st())});draw(st())}</script>`;
}


/**
 * Cart card: every line with − / + buttons, the total and "💳 Pay".
 * chat_data: {l: [[name, qty, unitPrice, sizeCode]], t: total, d: deliveryFee}.
 * Built with DOM calls (no innerHTML), so names can never inject markup.
 */
export function buildCartWidget(): string {
  return `<style>body{margin:0;font:14px sans-serif}h3{margin:0 0 4px;font-size:15px}.r{display:flex;align-items:center;gap:6px;padding:3px 0}.n{flex:1}.r button{width:30px;padding:4px 0;border:0;border-radius:8px;background:var(--tg-theme-secondary-bg-color,#eee);font-size:15px}.p{min-width:56px;text-align:right;color:var(--tg-theme-hint-color,#888);font-size:12px}.a{width:100%;padding:10px;border:0;border-radius:12px;background:#c08a3e;color:#fff;font-size:15px;font-weight:700;margin:8px 0 2px}#m{font-size:12px;min-height:15px;color:var(--tg-theme-hint-color,#888)}</style>`
    + `<div><h3>🛒 Your order</h3><div id=L></div><div id=T></div><button class=a id=P>💳 Pay</button><div id=m>&nbsp;</div></div>`
    + `<script>var W=window.TelegramWidget,Z={S:'',M:' (M)',L:' (L)'};`
    + `function st(){var c=W.chatData;if(c&&typeof c==='object')return c;try{return JSON.parse(c||'{}')}catch(e){return{}}}`
    + `function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}`
    + `function draw(s){var L=document.getElementById('L'),l=s.l||[];while(L.firstChild)L.removeChild(L.firstChild);`
    + `if(!l.length)L.appendChild(el('div','p','Empty — tell me what you would like ☕'));`
    + `l.forEach(function(x,i){var r=el('div','r'),d=el('button',null,'−'),u=el('button',null,'+');d.addEventListener('click',function(){q('cd:'+i)});u.addEventListener('click',function(){q('ci:'+i)});`
    + `r.appendChild(el('span','n',x[0]+(Z[x[3]]||'')));r.appendChild(d);r.appendChild(el('b',null,String(x[1])));r.appendChild(u);r.appendChild(el('span','p',(x[1]*x[2])+' ETB'));L.appendChild(r)});`
    + `document.getElementById('T').textContent=l.length?('Total '+(s.t||0)+' ETB'+(s.d?' (incl. '+s.d+' delivery)':'')):'';`
    + `var P=document.getElementById('P');P.disabled=!l.length;P.textContent=l.length?('💳 Pay '+(s.t||0)+' ETB'):'💳 Pay';`
    + `document.getElementById('m').textContent=s.err||' '}`
    + `function q(x){if(!W)return;W.request(x).then(function(a){if(a&&a.result){try{draw(JSON.parse(a.result))}catch(e){}}}).catch(function(){})}`
    + `document.getElementById('P').addEventListener('click',function(){q('checkout')});`
    + `if(W){W.onEvent('chatDataChanged',function(){draw(st())});draw(st())}</script>`;
}

const SIZE_CODE: Record<string, string> = { Small: "S", Medium: "M", Large: "L" };

/** Compact cart state for the cart widget (kept under the 1,024-byte chat_data limit). */
export function cartWidgetState(userId: number): Record<string, unknown> {
  const cart = getCart(userId);
  if (!cart) return { l: [], t: 0, d: 0 };
  const { total, deliveryFee } = draftTotals(cart);
  let nameLen = 22;
  for (;;) {
    const state = {
      l: cart.lines.slice(0, 12).map((l) => [l.name.slice(0, nameLen), l.qty, l.unitPrice, SIZE_CODE[l.options?.Size ?? ""] ?? "S"]),
      t: total,
      d: deliveryFee,
    };
    if (JSON.stringify(state).length <= 1000 || nameLen <= 6) return state;
    nameLen -= 4;
  }
}

/**
 * Show the cart card. "resend": delete the old card and send a fresh one at
 * the bottom of the chat (cart changed in conversation). "edit": update the
 * existing card in place (a tap on the card itself), sending one if none.
 */
export async function refreshCartWidget(chatId: number, userId: number, mode: "resend" | "edit"): Promise<{ ok: boolean; reason?: string }> {
  const state = cartWidgetState(userId);
  const prev = getCartWidget(userId);
  if (mode === "edit" && prev) {
    const r = await editWidgetDataRaw(prev.chatId, prev.messageId, state);
    if (r.ok) return { ok: true };
  }
  if (prev) {
    deleteMessage(prev.chatId, prev.messageId).catch(() => undefined);
    setCartWidget(userId, undefined);
  }
  const total = (state.t as number) || 0;
  const r = await sendWidgetRaw(chatId, buildCartWidget(), state, total ? `🛒 Your order — ${total} ETB` : "🛒 Your order");
  if (r.ok && r.messageId) {
    setCartWidget(userId, { chatId, messageId: r.messageId });
    setWidgetState(`${chatId}:${r.messageId}`, state);
  }
  return { ok: r.ok, reason: r.reason };
}

// ---------- raw Bot API calls (grammY has no widget methods yet) ----------

export async function sendWidgetRaw(
  chatId: number,
  html: string,
  chatData: Record<string, unknown>,
  caption: string,
): Promise<{ ok: boolean; messageId?: number; reason?: string }> {
  const r = await tgCall("sendWidget", {
    chat_id: chatId,
    html,
    chat_data: JSON.stringify(chatData),
    allow_queries: true,
    caption,
  });
  const mid = (r.result as { message_id?: number } | undefined)?.message_id;
  return r.ok ? { ok: true, messageId: mid } : { ok: false, reason: r.reason };
}

export async function answerWidgetQueryRaw(queryId: string, data: Record<string, unknown>): Promise<TgResult> {
  return tgCall("answerWidgetQuery", { widget_query_id: queryId, data: JSON.stringify(data) });
}

export async function editWidgetDataRaw(
  chatId: number,
  messageId: number,
  chatData: Record<string, unknown>,
): Promise<TgResult> {
  return tgCall("editMessageWidgetData", {
    chat_id: chatId,
    message_id: messageId,
    chat_data: JSON.stringify(chatData),
  });
}

// ---------- sending widgets ----------

/** Send an item card to a private chat; initialises its server-side state. */
export async function sendItemWidget(
  chatId: number,
  itemId: string,
): Promise<{ ok: boolean; messageId?: number; reason?: string }> {
  const item = getMenuItem(itemId);
  if (!item) return { ok: false, reason: "Item not found" };
  const html = buildItemWidget(item, stockLeft(itemId));
  const state = { i: item.id, p: item.price, s: "S", q: 0, a: 0 };
  const r = await sendWidgetRaw(chatId, html, state, `☕ ${item.name} — ${item.price} ETB`);
  if (r.ok && r.messageId) setWidgetState(`${chatId}:${r.messageId}`, state);
  return r;
}

/** Send an order tracker card to the customer; records message id on the order. */
export async function sendOrderTrackerWidget(
  orderId: string,
): Promise<{ ok: boolean; messageId?: number; reason?: string }> {
  const order = getOrder(orderId);
  if (!order) return { ok: false, reason: "Order not found" };
  const html = buildOrderWidget(order);
  const state = { o: order.id, s: order.status };
  const r = await sendWidgetRaw(order.userId, html, state, `🧾 Order ${order.id} — ${order.status}`);
  if (r.ok && r.messageId) setOrderTrackerWidget(order.id, order.userId, r.messageId);
  return r;
}

/** Re-render the tracker widget in place after a status change (no-op if none). */
export async function updateOrderTrackerWidget(orderId: string): Promise<TgResult> {
  const order = getOrder(orderId);
  if (!order) return { ok: false, reason: "Order not found" };
  if (!order.trackerWidget) return { ok: false, reason: "no tracker widget" };
  const state = { o: order.id, s: order.status };
  return editWidgetDataRaw(order.trackerWidget.chatId, order.trackerWidget.messageId, state);
}

// ---------- widget_query handling ----------

export interface WidgetQuery {
  id: string;
  from: { id: number; first_name?: string; username?: string };
  chat: { id: number; type?: string };
  message_id: number;
  data?: string;
  type?: { type: string; [k: string]: unknown };
}

export function isWidgetQuery(u: unknown): u is { widget_query: WidgetQuery } {
  return !!u && typeof u === "object" && "widget_query" in (u as Record<string, unknown>);
}

/**
 * Route one widget_query. Answers EVERY query (within 15 s, also on failure)
 * and never throws. The query's `data` is untrusted input — the real state
 * lives server-side (widgetStates + drafts) and is re-checked (stock, item).
 */
export async function handleWidgetQuery(q: WidgetQuery): Promise<{
  ok: boolean;
  answered: boolean;
  edited: boolean;
  action?: string;
  note?: string;
}> {
  const chatId = q.chat?.id;
  const messageId = q.message_id;
  const data = (q.data || "").trim();
  const userId = q.from?.id ?? chatId;
  const key = `${chatId}:${messageId}`;
  const answer = async (payload: Record<string, unknown>): Promise<boolean> => {
    const r = await answerWidgetQueryRaw(q.id, payload);
    return r.ok;
  };
  try {
    if (!chatId || !messageId) {
      await answer({});
      return { ok: false, answered: true, edited: false, note: "missing chat/message" };
    }
    if (q.type && q.type.type !== "data") {
      // Wallet / sign / other query types are not used by Buna widgets.
      await answer({});
      return { ok: true, answered: true, edited: false, action: "other-type" };
    }

    // --- size:<itemId>:<S|M|L> : pick a size, update the card in place ---
    if (data.startsWith("size:")) {
      const [, itemId, size] = data.split(":");
      const item = getMenuItem(itemId || "");
      const state = { ...getWidgetState(key), i: itemId, s: SIZE_LABEL[size] ? size : "S", p: item?.price ?? 0 };
      if (item) setWidgetState(key, state);
      const edited = item ? (await editWidgetDataRaw(chatId, messageId, state)).ok : false;
      const answered = await answer(state);
      return { ok: !!item, answered, edited, action: "size", note: item ? undefined : "unknown item" };
    }

    // --- add:<itemId>:<S|M|L> : add one to the user's widget draft ---
    if (data.startsWith("add:")) {
      const [, itemId, size] = data.split(":");
      const item = getMenuItem(itemId || "");
      if (!item) {
        await answer({ err: "Item not found" });
        return { ok: false, answered: true, edited: false, action: "add", note: "unknown item" };
      }
      const sizeCode = SIZE_LABEL[size] ? size : "S";
      const unitPrice = item.price + (SIZE_DELTA[sizeCode] ?? 0);
      const options: Record<string, string> = item.options?.some((g) => g.name === "Size")
        ? { Size: SIZE_LABEL[sizeCode] }
        : {};
      const line: OrderLine = {
        id: item.id,
        name: item.name,
        qty: 1,
        unitPrice,
        options,
        image: item.image,
      };
      // Stock is checked against what is already in the draft + this one.
      const draftId = getWidgetDraftId(userId);
      const existingQty = draftId
        ? (getDraft(draftId)?.lines.filter((l) => l.id === item.id).reduce((n, l) => n + l.qty, 0) ?? 0)
        : 0;
      const left = stockLeft(item.id);
      if (existingQty + 1 > left || left <= 0 || item.soldOut) {
        const state = { ...getWidgetState(key), i: item.id, p: item.price, s: sizeCode, err: left <= 0 ? `${item.name} is sold out` : `Only ${left} left` };
        await answer(state);
        return { ok: false, answered: true, edited: false, action: "add", note: "out of stock" };
      }
      const { draft, lineQty } = addToWidgetDraft(userId, line);
      void draft;
      const state = { ...getWidgetState(key), i: item.id, p: item.price, s: sizeCode, q: lineQty, a: 1 };
      setWidgetState(key, state);
      const edited = (await editWidgetDataRaw(chatId, messageId, state)).ok;
      const answered = await answer(state);
      // The cart card moves to the bottom with the new line in it.
      await refreshCartWidget(chatId, userId, "resend").catch(() => undefined);
      return { ok: true, answered, edited, action: "add" };
    }

    // --- checkout : send a Telegram Stars invoice for the user's cart, in this chat ---
    if (data === "checkout") {
      const sent = await sendCartInvoice(userId, chatId);
      if (!sent.ok) {
        const err = sent.reason === "empty"
          ? "Your cart is empty — tap Add to cart first."
          : sent.reason === "stock"
            ? sent.detail ?? "Something is sold out"
            : "Couldn't send the invoice, try again.";
        await answer({ err });
        return { ok: false, answered: true, edited: false, action: "checkout", note: sent.reason === "empty" ? "empty cart" : sent.reason };
      }
      const answered = await answer({ ok: 1 });
      return { ok: true, answered, edited: false, action: "checkout" };
    }

    // --- ci:<index> / cd:<index> : + / − on a cart-card line ---
    if (data.startsWith("ci:") || data.startsWith("cd:")) {
      const cart = getCart(userId);
      const line = cart?.lines[Number(data.slice(3))];
      if (!cart || !line) {
        const state = cartWidgetState(userId);
        await editWidgetDataRaw(chatId, messageId, state);
        await answer(state);
        return { ok: false, answered: true, edited: true, action: "cart", note: "line not found" };
      }
      if (data.startsWith("ci:")) {
        const inCart = cart.lines.filter((l) => l.id === line.id).reduce((n, l) => n + l.qty, 0);
        const left = stockLeft(line.id);
        if (inCart + 1 > left) {
          const state = { ...cartWidgetState(userId), err: left <= 0 ? `${line.name} is sold out` : `Only ${left} left` };
          await answer(state);
          return { ok: false, answered: true, edited: false, action: "cart", note: "out of stock" };
        }
        line.qty += 1;
      } else {
        line.qty -= 1;
        if (line.qty <= 0) cart.lines = cart.lines.filter((l) => l !== line);
      }
      const state = cartWidgetState(userId);
      setWidgetState(key, state);
      const edited = (await editWidgetDataRaw(chatId, messageId, state)).ok;
      const answered = await answer(state);
      return { ok: true, answered, edited, action: "cart" };
    }

    // --- refresh:<orderId> : re-read the order and update the tracker ---
    if (data.startsWith("refresh:")) {
      const orderId = data.slice("refresh:".length);
      const order = getOrder(orderId);
      if (!order) {
        await answer({ err: "Order not found" });
        return { ok: false, answered: true, edited: false, action: "refresh", note: "unknown order" };
      }
      const state = { ...getWidgetState(key), o: order.id, s: order.status };
      setWidgetState(key, state);
      const edited = (await editWidgetDataRaw(chatId, messageId, state)).ok;
      const answered = await answer(state);
      return { ok: true, answered, edited, action: "refresh" };
    }

    await answer({});
    return { ok: true, answered: true, edited: false, action: "unknown" };
  } catch {
    try {
      await answer({});
    } catch { /* never throw from a query handler */ }
    return { ok: false, answered: false, edited: false, note: "handler error" };
  }
}
