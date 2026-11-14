// Buna AI — a salesperson that lives entirely inside the Telegram chat.
//
// Built as a LangGraph tool-calling loop:
//
//     START → agent ──(tool calls?)──► tools ──► agent … ──(no calls)──► END
//
// The model (Gemini via @langchain/google-genai) talks to the customer and
// calls tools: show_item, add_to_cart, update_cart_item, remove_from_cart,
// set_delivery, checkout, show_more, speak. The server runs every tool with
// its own checks (item exists, stock, sizes) and returns the TRUE result to
// the model, which then writes its reply — so it can never say "added" or
// "updated" when nothing happened.
//
// Things a customer should SEE (item photo + widget, cart card, invoice,
// Mini App link) are queued as "deliveries" and sent right after the reply.
// Without GEMINI_API_KEY (or if the model fails) a rule-based mock
// salesperson runs the same actions, so the bot never goes silent.

import { z } from "zod";
import { StateGraph, MessagesAnnotation, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MENU_ITEMS } from "./data";
import {
  aiConfigured,
  CHAT_FALLBACK_MODEL,
  CHAT_MODEL,
  findMentionedItem,
  inStockPopular,
  stockContext,
  type AiLang,
} from "./ai";
import {
  addToWidgetDraft,
  appendTurn,
  checkStock,
  getCart,
  getMenuItem,
  getOrCreateUserMemory,
  noteUserTurn,
  removeFromCart,
  setCallName,
  setCartDelivery,
  setNameState,
  setUserLang,
  stockLeft,
  updateCartItem,
  type OrderLine,
  type UserMemory,
} from "./store";
import { draftTotals, sendCartInvoice, starsFor } from "./checkout";
import { refreshCartWidget, sendItemWidget, SIZE_DELTA, SIZE_LABEL } from "./widget";
import { miniAppKeyboard, sendPhoto, sendText } from "./tg";

// ---------- actions ----------

export type AgentAction =
  | { type: "show_item"; id: string }
  | { type: "add_to_cart"; id: string; size?: "S" | "M" | "L"; qty?: number }
  | { type: "update_cart_item"; id: string; size?: "S" | "M" | "L"; qty?: number }
  | { type: "remove_from_cart"; id: string }
  | { type: "set_delivery"; fulfillment: "pickup" | "delivery"; address?: string }
  | { type: "checkout" }
  | { type: "show_more" }
  /** internal: re-send the cart card because the cart changed this turn */
  | { type: "cart" };

/** Everything one turn did, collected by the tools (or the mock). */
interface TurnCtx {
  userId: number;
  lang: AiLang;
  deliver: AgentAction[];
  cartChanged: boolean;
  wantsVoice: boolean;
}

// ---------- language ----------

const EN_WORDS = /\b(the|i|want|a|an|please|hello|hi|hey|can|what|how|do|you|is|it|my|me|to|for|with|and|have|would|like|thanks|thank|yes|no|where|see|show)\b/gi;
const LATIN_AM = /(selam|salam|endemen|indemen|betam|ameseginalehu|amesegnalehu|dehna|buna|shai|ewo|\bmin\b|\bale\b|\beka\b|alesh|aleh)/i;

/** Ethiopic -> am; clearly English -> en; otherwise keep the previous language. */
export function pickLang(text: string, prev: AiLang): AiLang {
  if (/[ሀ-፼]/.test(text)) return "am";
  if ((text.match(EN_WORDS) ?? []).length >= 2) return "en";
  if (LATIN_AM.test(text)) return "am";
  return prev;
}

// ---------- intent helpers (mock mode, name guard, "show me") ----------

const PAY_EN = /\b(pay|checkout|check out|invoice|that'?s all|thats all|i'?m done|im done)\b/i;
const PAY_AM = /ክፈል|ልክፈል|ክፍያ|ጨርሻለሁ|ይበቃል|ይበቃኛል/;
const CONFIRM = /^(yes|yeah|yep|ok|okay|sure|confirm|order it|place it|do it|እሺ|አዝዝ|ይሁን|አዎ|አዎን)[!. ]*$/i;
const BUY_EN = /\b(order|add|want|get|take|buy|give me|i'?ll have|i will have)\b/i;
const BUY_AM = /እፈልጋለሁ|አዝዝ|ስጠኝ|እወስዳለሁ|ጨምር|ልውሰድ|እሻለሁ|ላክልኝ/;
// "see more" wants: STRONG ones win even when an item is named; WEAK ones
// ("tell me more about croissant") should show that item's card instead.
const MORE_STRONG = /\b(full menu|everything|all (the )?items|photos|pictures)\b|ሙሉ ምናሌ|ሙሉ ሜኑ|ሁሉንም/i;
const MORE_WEAK = /\b(menu|details?|more (info|about|options|items))\b|ምናሌ|ሜኑ|ዝርዝር|ተጨማሪ/i;
const SEE = /\b(see|show|look|photo|picture|pic|where is|where's)\b|አሳየኝ|አሳዩኝ|ልየው|ላየው|ልይ|ፎቶ/i;
const DELIVERY_EN = /\b(deliver|delivery)\b/i;
const DELIVERY_AM = /ማድረስ|ይድረሰኝ|አድርሱልኝ|ዴሊቨሪ/;

export const wantsPay = (t: string) => PAY_EN.test(t) || PAY_AM.test(t);
export const isConfirmation = (t: string) => CONFIRM.test(t.trim());
const wantsToBuy = (t: string) => BUY_EN.test(t) || BUY_AM.test(t);
const wantsMoreStrong = (t: string) => MORE_STRONG.test(t);
const wantsMore = (t: string) => MORE_STRONG.test(t) || MORE_WEAK.test(t);
const wantsToSee = (t: string) => SEE.test(t);
const wantsDelivery = (t: string) => DELIVERY_EN.test(t) || DELIVERY_AM.test(t);

function sizeFrom(t: string): "S" | "M" | "L" | undefined {
  if (/\blarge\b|ትልቅ/i.test(t)) return "L";
  if (/\bmedium\b|መካከለኛ/i.test(t)) return "M";
  if (/\bsmall\b|ትንሽ/i.test(t)) return "S";
  return undefined;
}

function qtyFrom(t: string): number {
  const d = t.match(/\b(\d{1,2})\b/);
  if (d) return Math.max(1, Math.min(10, Number(d[1])));
  if (/\btwo\b|ሁለት/i.test(t)) return 2;
  if (/\bthree\b|ሶስት/i.test(t)) return 3;
  return 1;
}

// ---------- the customer's name ----------

const NOT_NAMES = /^(yes|yeah|yep|no|nope|ok|okay|hi|hello|hey|thanks|thank you|please|menu|more|pay|checkout|selam|ሰላም|እሺ|አዎ|አይ|አመሰግናለሁ|medium|large|small)$/i;
const NOT_A_NAME_WORD = /^(hungry|fine|good|great|well|here|back|looking|interested|thirsty|tired|new|just|so|very|not|going|trying|wondering|want|ready|sure)$/i;
const FILLER = /^(i'?m|im|i|am|a|an|the|is|it|my|me|we|you|and|or|to|for|with|can|do|please)$/i;

function tidyName(raw: string): string {
  const n = raw.replace(/[^\p{L}'-]/gu, "").slice(0, 24);
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
}

/**
 * Pull a first name out of the customer's reply to "what's your name?".
 * explicit=true when they said it with a phrase ("I'm Abebe", "ስሜ አበበ ነው");
 * explicit=false when the whole message is just the name ("Abebe").
 */
export function extractName(text: string): { name: string; explicit: boolean } | null {
  const t = text.trim().replace(/[.!?፡።]+$/g, "");
  if (!t || t.length > 60) return null;
  const explicitRes = [
    /(?:my name is|my name's|name is|call me|i am|i'm|im|this is)\s+([\p{L}'-]+)/iu,
    /ስሜ\s+([ሀ-፿]+)/u,
    /^([ሀ-፿]+)\s+(?:እባላለሁ|ነኝ|ነው ስሜ)/u,
    /እኔ\s+([ሀ-፿]+)\s+ነኝ/u,
  ];
  for (const re of explicitRes) {
    const m = t.match(re);
    if (m && !NOT_A_NAME_WORD.test(m[1])) {
      const name = tidyName(m[1]);
      if (name.length >= 2) return { name, explicit: true };
    }
  }
  const words = t.split(/\s+/);
  if (
    words.length <= 2 &&
    words.every((w) => /^[\p{L}'-]{2,20}$/u.test(w) && !NOT_A_NAME_WORD.test(w) && !FILLER.test(w)) &&
    !NOT_NAMES.test(t) &&
    !findMentionedItem(t) &&
    !wantsToBuy(t) && !wantsPay(t) && !wantsMore(t)
  ) {
    const name = tidyName(words[0]);
    if (name.length >= 2) return { name, explicit: false };
  }
  return null;
}

/** Ask the customer's name once, after they've exchanged a few messages. */
const ASK_NAME_AFTER_TURNS = 3;
/** Voice notes stay occasional: at most one every N customer messages (unless they sent voice). */
const VOICE_EVERY_TURNS = 3;

// ---------- applying actions (shared by the tools and the mock) ----------

const t2 = (lang: AiLang, am: string, en: string) => (lang === "am" ? am : en);

function cartLine(userId: number): string {
  const cart = getCart(userId);
  if (!cart) return "cart is empty";
  const { total } = draftTotals(cart);
  return `cart now: ${cart.lines.map((l) => `${l.qty}× ${l.name}${l.options?.Size ? ` (${l.options.Size})` : ""}`).join(", ")} — total ${total} ETB`;
}

/** Run one action with server-side checks. ok=false carries a message for the customer/model. */
function applyAction(ctx: TurnCtx, a: AgentAction): { ok: boolean; msg: string } {
  const { userId, lang } = ctx;
  const mem = getOrCreateUserMemory(userId);
  switch (a.type) {
    case "show_item": {
      const item = getMenuItem(a.id);
      if (!item || item.hidden) return { ok: false, msg: `no item with id ${a.id}` };
      mem.lastItemId = item.id;
      if (!ctx.deliver.some((d) => d.type === "show_item" && d.id === item.id)) ctx.deliver.push({ type: "show_item", id: item.id });
      const left = stockLeft(item.id);
      return { ok: true, msg: `photo + card for ${item.name} will appear under your message (${left <= 0 ? "SOLD OUT" : `${left} left`})` };
    }
    case "add_to_cart": {
      const item = getMenuItem(a.id);
      if (!item || item.hidden) return { ok: false, msg: t2(lang, "ያ ነገር ሜኑው ላይ የለም።", "Sorry, I couldn't find that item.") };
      const hasSize = !!item.options?.some((g) => g.name === "Size");
      const code = hasSize ? (a.size ?? "S") : "S";
      const qty = a.qty ?? 1;
      const inCart = getCart(userId)?.lines.filter((l) => l.id === item.id).reduce((n, l) => n + l.qty, 0) ?? 0;
      const left = stockLeft(item.id);
      if (left <= 0 || item.soldOut) return { ok: false, msg: t2(lang, `😕 ${item.name} ዛሬ አልቋል።`, `Sorry, ${item.name} is sold out today.`) };
      if (inCart + qty > left) return { ok: false, msg: t2(lang, `${item.name} የቀረው ${left} ብቻ ነው።`, `Only ${left} ${item.name} left.`) };
      const line: OrderLine = {
        id: item.id,
        name: item.name,
        qty,
        unitPrice: item.price + (hasSize ? SIZE_DELTA[code] ?? 0 : 0),
        options: hasSize ? { Size: SIZE_LABEL[code] } : {},
        image: item.image,
      };
      addToWidgetDraft(userId, line);
      mem.lastItemId = item.id;
      ctx.cartChanged = true;
      return { ok: true, msg: `added. ${cartLine(userId)}` };
    }
    case "update_cart_item": {
      const item = getMenuItem(a.id);
      const line = item ? getCart(userId)?.lines.find((l) => l.id === item.id) : undefined;
      if (!item || !line) return { ok: false, msg: `${item?.name ?? a.id} is not in the cart — use add_to_cart` };
      if (typeof a.qty === "number" && a.qty > 0) {
        const others = getCart(userId)!.lines.filter((l) => l.id === item.id && l !== line).reduce((n, l) => n + l.qty, 0);
        if (others + a.qty > stockLeft(item.id)) return { ok: false, msg: t2(lang, `${item.name} የቀረው ${stockLeft(item.id)} ብቻ ነው።`, `Only ${stockLeft(item.id)} ${item.name} left.`) };
      }
      updateCartItem(userId, item.id, { size: a.size ? (SIZE_LABEL[a.size] as "Small" | "Medium" | "Large") : undefined, qty: a.qty });
      mem.lastItemId = item.id;
      ctx.cartChanged = true;
      return { ok: true, msg: `updated. ${cartLine(userId)}` };
    }
    case "remove_from_cart": {
      const removed = removeFromCart(userId, a.id);
      if (removed) ctx.cartChanged = true;
      return { ok: removed, msg: removed ? `removed. ${cartLine(userId)}` : "that item was not in the cart" };
    }
    case "set_delivery": {
      setCartDelivery(userId, a.fulfillment, a.address?.trim() || undefined);
      ctx.cartChanged = true;
      const c = getCart(userId);
      return { ok: true, msg: a.fulfillment === "pickup" ? "pickup set (free)" : c?.address ? `delivery to "${c.address}" (+50 ETB)` : "delivery set (+50 ETB) — ADDRESS STILL NEEDED, ask for it" };
    }
    case "checkout": {
      const cart = getCart(userId);
      if (!cart) return { ok: false, msg: "cart is empty — ask what they'd like" };
      const stockError = checkStock(cart.lines.map((l) => ({ id: l.id, qty: l.qty })));
      if (stockError) return { ok: false, msg: stockError };
      if (cart.fulfillment === "delivery" && !cart.address) return { ok: false, msg: "delivery address missing — ask for it first" };
      if (!ctx.deliver.some((d) => d.type === "checkout")) ctx.deliver.push({ type: "checkout" });
      const total = draftTotals(cart).total;
      return { ok: true, msg: `a Telegram Stars invoice for ${total} ETB (${starsFor(total)} Stars) will appear under your message` };
    }
    case "show_more":
      if (!ctx.deliver.some((d) => d.type === "show_more")) ctx.deliver.push({ type: "show_more" });
      return { ok: true, msg: "a button to the full menu (Mini App) will appear under your message" };
    case "cart":
      return { ok: true, msg: "" };
  }
}

// ---------- LangGraph agent (live model) ----------

const SizeEnum = z.enum(["S", "M", "L"]).optional().describe("S/M/L — only for items that have sizes");

function makeTools(ctx: TurnCtx) {
  const run = (a: AgentAction) => {
    const r = applyAction(ctx, a);
    return r.ok ? `OK: ${r.msg}` : `FAILED: ${r.msg}`;
  };
  return [
    tool(({ id }) => run({ type: "show_item", id }), {
      name: "show_item",
      description: "Show a product to the customer: its photo and interactive card (sizes, add, pay) appear in the chat. Use whenever they ask about, want to see, or are deciding on a specific product.",
      schema: z.object({ id: z.string().describe("menu item id") }),
    }),
    tool(({ id, size, qty }) => run({ type: "add_to_cart", id, size, qty }), {
      name: "add_to_cart",
      description: "Add a NEW item to the cart, only when the customer clearly wants it.",
      schema: z.object({ id: z.string(), size: SizeEnum, qty: z.number().int().min(1).max(10).optional() }),
    }),
    tool(({ id, size, qty }) => run({ type: "update_cart_item", id, size, qty }), {
      name: "update_cart_item",
      description: "Change an item ALREADY in the cart — its size and/or quantity (qty 0 removes it). Use this, not add_to_cart, when they change their mind about size or amount.",
      schema: z.object({ id: z.string(), size: SizeEnum, qty: z.number().int().min(0).max(20).optional() }),
    }),
    tool(({ id }) => run({ type: "remove_from_cart", id }), {
      name: "remove_from_cart",
      description: "Remove an item from the cart.",
      schema: z.object({ id: z.string() }),
    }),
    tool(({ fulfillment, address }) => run({ type: "set_delivery", fulfillment, address }), {
      name: "set_delivery",
      description: "Pickup (free) or delivery (+50 ETB). For delivery pass the address once you know it.",
      schema: z.object({ fulfillment: z.enum(["pickup", "delivery"]), address: z.string().max(200).optional() }),
    }),
    tool(() => run({ type: "checkout" }), {
      name: "checkout",
      description: "Send the payment (a Telegram Stars invoice) into the chat. Use when they're ready to pay or say that's all.",
      schema: z.object({}),
    }),
    tool(() => run({ type: "show_more" }), {
      name: "show_more",
      description: "Send a link button to the full menu with photos (Mini App). ONLY when they ask to see the whole menu / everything / more details.",
      schema: z.object({}),
    }),
    tool(() => {
      ctx.wantsVoice = true;
      return "OK: your reply will also go out as a voice note";
    }, {
      name: "speak",
      description: "Also send your reply as a voice note. Use now and then (about one message in four): describing a product you love, after learning their name, saying thanks. Keep that reply short.",
      schema: z.object({}),
    }),
  ];
}

function menuWithIds(): string {
  return MENU_ITEMS.filter((m) => !m.hidden)
    .map((m) => {
      const sized = m.options?.some((g) => g.name === "Size") ? " [sizes S / M +30 / L +60]" : "";
      return `- id=${m.id} · ${m.name} (${m.amharicName}) — ${m.price} ETB, ${m.category}${sized}: ${m.description}`;
    })
    .join("\n");
}

function systemPrompt(mem: UserMemory, userId: number, o: { askName: boolean; justSavedName?: string; lang: AiLang; viaVoice: boolean }): string {
  const cart = getCart(userId);
  const cartText = cart
    ? `${cartLine(userId)}; ${cart.fulfillment === "delivery" ? `delivery (address: ${cart.address ?? "NOT GIVEN"})` : "pickup"}`
    : "empty";
  return `You are Buna, the barista and salesperson of Buna Corner, a coffee shop in Bole, Addis Ababa. You're texting a customer in a Telegram DM — the whole sale happens right here.

HOW YOU TALK
- Like a friendly young barista texting: 1-2 short sentences, plain text, no markdown, no lists. One question at most.
- Language: ${o.lang === "am" ? "Amharic" : "English"} (follow the customer if they switch).
- Amharic must be SIMPLE, everyday Addis chat — short common words, how friends text. NOT formal or polite-written style: avoid -ዎት/እርስዎ forms ("ልጠጣልዎት", "ይፈልጋሉ", "በደህና መጡ") and bookish words. Mixing common English words (order, size, cart, ok, menu) is normal. When you don't know if the customer is male or female, use neutral phrasing ("ምን ይሁን?", "ልጨምረው?", "ይኸው", "ስም ማን ልበል?").
- Never say "tap", "click" or "button"; never list the whole menu. Recommend one or two things; upsell gently (bigger size, a pastry, beans to take home).
- The chat already opened with "ሰላም" — don't greet again.
- If asked whether you're a bot, be honest: you're Buna Corner's AI assistant.

HOW YOU SELL — use the tools, they do the real work
- Customer asks about / wants to see / is choosing a product → show_item (photo + card appear in the chat). If they say "show me" or "where is it", call show_item again for that product.
- They want something → add_to_cart. They change size or amount of something already in the cart → update_cart_item (never add a second one).
- Ready / "that's all" / "pay" → checkout. Delivery → set_delivery, and ask for the address if you don't have it.
- show_more ONLY when they ask for the full menu / everything / more details.
- speak now and then${o.viaVoice ? " (the customer sent a VOICE note — answer warmly and briefly; your reply will be spoken)" : ""}.
- Trust the tool results: if a tool says FAILED, tell the customer honestly and offer an alternative. Never say you did something a tool didn't confirm. Never invent items or prices; never sell sold-out items.
${o.askName ? "- In THIS reply, also ask the customer's name naturally (a short question at the end).\n" : ""}${o.justSavedName ? `- The customer just told you their name: ${o.justSavedName}. Acknowledge it warmly in a few words.\n` : ""}
MENU:
${menuWithIds()}

LIVE STOCK:
${stockContext()}

CUSTOMER
- Name: ${mem.callName ?? "not known yet — don't use their Telegram name"}${mem.callName ? " (use it now and then, not every message)" : ""}
- Past orders: ${mem.prefs.orderCount}; favourites: ${mem.prefs.favourites.map((id) => getMenuItem(id)?.name).filter(Boolean).slice(0, 3).join(", ") || "none yet"}
- Last product discussed: ${mem.lastItemId ? getMenuItem(mem.lastItemId)?.name : "none"}
- Cart: ${cartText}

Delivery 50 ETB, pickup free. Every 8th coffee free (stamp card). Beans of the Month 900 ETB/month. Payment is Telegram Stars; prices are in ETB.`;
}

function geminiModel(model: string): BaseChatModel {
  return new ChatGoogleGenerativeAI({ model, apiKey: process.env.GEMINI_API_KEY, temperature: 0.8, maxOutputTokens: 800, maxRetries: 1 }) as unknown as BaseChatModel;
}

function textOf(m: BaseMessage | undefined): string {
  if (!m) return "";
  const c = m.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === "string" ? p : (p as { type?: string; text?: string }).type === "text" ? (p as { text?: string }).text ?? "" : ""))
      .join("")
      .trim();
  }
  return "";
}

/** One LangGraph run: agent ⇄ tools until the model writes its reply. */
async function runGraph(model: BaseChatModel, ctx: TurnCtx, system: string, history: BaseMessage[], fallback?: BaseChatModel): Promise<string> {
  const tools = makeTools(ctx);
  if (!model.bindTools) throw new Error("model has no tool calling");
  let bound = model.bindTools(tools);
  if (fallback?.bindTools) bound = bound.withFallbacks([fallback.bindTools(tools)]) as unknown as typeof bound;

  const graph = new StateGraph(MessagesAnnotation)
    .addNode("agent", async (state) => ({ messages: [await bound.invoke([new SystemMessage(system), ...state.messages])] }))
    .addNode("tools", new ToolNode(tools))
    .addEdge(START, "agent")
    .addConditionalEdges("agent", (state) => {
      const last = state.messages[state.messages.length - 1] as AIMessage;
      return last.tool_calls?.length ? "tools" : END;
    })
    .addEdge("tools", "agent")
    .compile();

  const out = await graph.invoke({ messages: history }, { recursionLimit: 12 });
  const reply = textOf(out.messages[out.messages.length - 1]);
  if (!reply) throw new Error("empty reply");
  return reply;
}

function historyMessages(mem: UserMemory): BaseMessage[] {
  const msgs: BaseMessage[] = mem.history.map((t) => (t.role === "ai" ? new AIMessage(t.text) : new HumanMessage(t.text)));
  while (msgs.length && msgs[0] instanceof AIMessage) msgs.shift(); // Gemini wants a user turn first
  return msgs;
}

// ---------- mock salesperson (no key / model error) ----------

function mockTurn(ctx: TurnCtx, text: string): string {
  const { userId, lang } = ctx;
  const cart = getCart(userId);
  const fails: string[] = [];
  const act = (a: AgentAction) => {
    const r = applyAction(ctx, a);
    if (!r.ok && a.type !== "checkout") fails.push(r.msg);
    return r;
  };
  const withFails = (s: string) => [s, ...fails].filter(Boolean).join("\n");

  const item = findMentionedItem(text);
  if (wantsMoreStrong(text) || (wantsMore(text) && !item)) {
    act({ type: "show_more" });
    return t2(lang, "እሺ! ሙሉ ሜኑው ከፎቶ ጋር ይኸው 👇", "Sure! Here's the full menu with photos 👇");
  }

  // They chose delivery and we're waiting for the address: this message is it.
  if (cart?.fulfillment === "delivery" && !cart.address && !wantsPay(text) && !isConfirmation(text) && !item) {
    act({ type: "set_delivery", fulfillment: "delivery", address: text.trim().slice(0, 200) });
    return t2(lang, "አድራሻው ደርሶኛል 📍 ክፍያ ልላክ? ወይስ ሌላ ይጨመር?", "Got your address 📍 Shall I send the payment, or add something?");
  }

  // A size on its own ("Medium") changes the last thing they ordered.
  const size = sizeFrom(text);
  const last = getOrCreateUserMemory(userId).lastItemId;
  if (!item && size && last && cart?.lines.some((l) => l.id === last)) {
    const r = act({ type: "update_cart_item", id: last, size });
    const name = getMenuItem(last)?.name ?? "";
    return withFails(r.ok ? t2(lang, `✅ ${name} ወደ ${SIZE_LABEL[size]} ተቀይሯል። ሌላ ነገር?`, `✅ Changed ${name} to ${SIZE_LABEL[size]}. Anything else?`) : "");
  }

  if (item) {
    const left = stockLeft(item.id);
    if (left <= 0 || item.soldOut) {
      const alt = MENU_ITEMS.find((m) => m.category === item.category && m.id !== item.id && !m.hidden && stockLeft(m.id) > 0) ?? inStockPopular(1)[0];
      if (alt) act({ type: "show_item", id: alt.id });
      return t2(
        lang,
        `😕 ${item.name} ዛሬ አልቋል።${alt ? ` ${alt.name} (${alt.price} ብር) ይሞከር? ጣፋጭ ነው።` : ""}`,
        `Sorry, ${item.name} is sold out today.${alt ? ` Want ${alt.name} (${alt.price} ETB) instead? It's lovely.` : ""}`,
      );
    }
    if (wantsToBuy(text)) {
      const qty = qtyFrom(text);
      const hasSize = item.options?.some((g) => g.name === "Size");
      const r = act({ type: "add_to_cart", id: item.id, size, qty });
      const label = `${qty > 1 ? `${qty}× ` : ""}${item.name}${hasSize && size ? ` (${SIZE_LABEL[size]})` : ""}`;
      return withFails(r.ok ? t2(lang, `✅ ${label} ተጨምሯል። ሌላ ነገር? ወይስ ክፍያ ልላክ?`, `Added ${label} ✅ Anything else, or shall I send the payment?`) : "");
    }
    act({ type: "show_item", id: item.id });
    return t2(lang, `${item.name} አለ! ${item.price} ብር ነው ☕ ልጨምረው?`, `Yes, we have ${item.name} — ${item.price} ETB. ${item.description} Shall I add one?`);
  }

  if (wantsDelivery(text)) {
    act({ type: "set_delivery", fulfillment: "delivery" });
    return t2(lang, "እናደርሳለን 🛵 (50 ብር)። አድራሻው የት ነው? 📍", "We deliver! (50 ETB) What's the address? 📍");
  }

  if (wantsPay(text) || (isConfirmation(text) && cart)) {
    if (!cart) return t2(lang, "ካርቱ ባዶ ነው 😄 ምን ይሁን?", "Your cart is empty — what would you like? ☕");
    act({ type: "checkout" });
    const total = draftTotals(cart).total;
    return t2(lang, `ጥሩ! ${total} ብር ነው — ክፍያው ይኸው 💳`, `Lovely! That's ${total} ETB — here's the payment 💳`);
  }

  const pick = inStockPopular(1)[0];
  return pick
    ? t2(lang, `ዛሬ ምን ይሁን? ${pick.name} (${pick.price} ብር) በጣም ይወደዳል ☕`, `What can I get you today? ${pick.name} (${pick.price} ETB) is a real favourite ☕`)
    : t2(lang, "ዛሬ ምን ይሁን? ☕", "What can I get you today? ☕");
}

// ---------- one conversational turn ----------

export interface AgentResult {
  reply: string;
  /** Sent AFTER the reply, in order: show_item…, cart, show_more, checkout. */
  deliver: AgentAction[];
  lang: AiLang;
  mock: boolean;
  askedName: boolean;
  savedName?: string;
  /** Send this reply as a voice note too. */
  voice: boolean;
  cartChanged: boolean;
}

export interface TurnOptions {
  lang?: AiLang;
  /** The customer sent a voice note (already transcribed): answer by voice. */
  viaVoice?: boolean;
  /** Inject a chat model (tests). Defaults to Gemini when GEMINI_API_KEY is set. */
  model?: BaseChatModel;
}

function orderDeliveries(ctx: TurnCtx): AgentAction[] {
  const rank: Record<string, number> = { show_item: 0, cart: 1, show_more: 2, checkout: 3 };
  const list = [...ctx.deliver];
  // The cart card goes out when the cart changed — unless the invoice (which itemises it) is coming anyway.
  if (ctx.cartChanged && !list.some((a) => a.type === "checkout") && getCart(ctx.userId)) list.push({ type: "cart" });
  return list.sort((a, b) => rank[a.type] - rank[b.type]);
}

export async function salesTurn(userId: number, tgFirstName: string, text: string, opts: TurnOptions = {}): Promise<AgentResult> {
  const mem = getOrCreateUserMemory(userId, tgFirstName);
  const lang = opts.lang ?? pickLang(text, mem.prefs.lang);
  setUserLang(userId, lang);
  const turns = noteUserTurn(userId);
  const viaVoice = !!opts.viaVoice;

  // They were asked their name last time: try to read it out of this reply.
  let savedName: string | undefined;
  let nameOnly = false;
  if (mem.nameState === "asked") {
    const ex = extractName(text);
    if (ex) {
      setCallName(userId, ex.name);
      savedName = ex.name;
      nameOnly = !ex.explicit;
    } else {
      setNameState(userId, "declined"); // never nag
    }
  }
  const mentioned = findMentionedItem(text);
  if (mentioned) mem.lastItemId = mentioned.id;
  appendTurn(userId, "user", text);

  if (savedName && nameOnly) {
    const cart = getCart(userId);
    const reply = t2(
      lang,
      `${savedName}! ደስ ብሎኛል 😊 ${cart ? "ክፍያ ልላክ? ወይስ ሌላ ይጨመር?" : "ዛሬ ምን ይሁን?"}`,
      `Nice to meet you, ${savedName}! 😊 ${cart ? "Shall I send the payment, or add something else?" : "What can I get you today?"}`,
    );
    appendTurn(userId, "ai", reply);
    // A warm moment: say it out loud (only when voice is possible and not too frequent).
    const voice = viaVoice || ((aiConfigured() || !!opts.model) && turns - (mem.lastVoiceTurn ?? -99) >= VOICE_EVERY_TURNS);
    if (voice) mem.lastVoiceTurn = turns;
    return { reply, deliver: [], lang, mock: !aiConfigured() && !opts.model, askedName: false, savedName, voice, cartChanged: false };
  }

  const askName = mem.nameState === "unknown" && turns >= ASK_NAME_AFTER_TURNS && !wantsPay(text);
  const ctx: TurnCtx = { userId, lang, deliver: [], cartChanged: false, wantsVoice: false };

  let reply = "";
  let mock = false;
  const live = opts.model ?? (aiConfigured() ? geminiModel(CHAT_MODEL) : undefined);
  if (live) {
    try {
      const system = systemPrompt(mem, userId, { askName, justSavedName: savedName, lang, viaVoice });
      reply = await runGraph(live, ctx, system, historyMessages(mem), opts.model ? undefined : geminiModel(CHAT_FALLBACK_MODEL));
    } catch (e) {
      console.error("[agent] live model failed, using mock:", e instanceof Error ? e.message : e);
      // Tool effects that already ran (cart lines) are real; the mock only phrases a reply.
      ctx.deliver = ctx.deliver.filter((a) => a.type !== "checkout");
      reply = mockTurn(ctx, text);
      mock = true;
    }
  } else {
    reply = mockTurn(ctx, text);
    mock = true;
  }
  if (!reply) reply = t2(lang, "ሌላ ምን ይሁን? ☕", "What else can I get you? ☕");

  // The mock can't phrase a natural name question inside its reply, so it appends one.
  if (askName && mock) reply += t2(lang, "\n\nበነገራችን ላይ ስም ማን ልበል? 😊", "\n\nBy the way, what's your name? 😊");
  if (askName) setNameState(userId, "asked");

  // "Let me see the macchiato" / "where is it? I want to see it" → the card
  // ALWAYS appears, even if the model only talked about the product.
  const seeTarget = wantsToSee(text) && !wantsMoreStrong(text)
    ? mentioned ?? (mem.lastItemId ? getMenuItem(mem.lastItemId) : undefined)
    : undefined;
  if (seeTarget && !ctx.deliver.some((a) => a.type === "show_item")) applyAction(ctx, { type: "show_item", id: seeTarget.id });

  const voice = viaVoice || (ctx.wantsVoice && turns - (mem.lastVoiceTurn ?? -99) >= VOICE_EVERY_TURNS);
  if (voice) mem.lastVoiceTurn = turns;

  appendTurn(userId, "ai", reply);
  return { reply, deliver: orderDeliveries(ctx), lang, mock, askedName: askName, savedName, voice, cartChanged: ctx.cartChanged };
}

// ---------- /start greeting (just "selam", no buttons, no name yet) ----------

export function startGreeting(userId: number, tgFirstName: string): string {
  const mem = getOrCreateUserMemory(userId, tgFirstName);
  const text = mem.callName ? `ሰላም ${mem.callName}! 👋 እንኳን ደህና መጣችሁ ☕` : "ሰላም 👋 ወደ ቡና ኮርነር እንኳን መጣችሁ ☕";
  appendTurn(userId, "ai", text);
  return text;
}

// ---------- delivering actions in the chat ----------

export interface DeliveryNote { action: string; ok: boolean; detail?: string }

/** Run show_item / cart / show_more / checkout in the customer's chat (never throws). */
export async function runDeliveryActions(chatId: number, userId: number, deliver: AgentAction[], lang: AiLang): Promise<DeliveryNote[]> {
  const notes: DeliveryNote[] = [];
  for (const a of deliver) {
    try {
      if (a.type === "show_item") {
        const item = getMenuItem(a.id);
        if (!item) continue;
        // A photo first — "let me see it" means SEE it — then the interactive card.
        const left = stockLeft(item.id);
        const photo = await sendPhoto(chatId, item.image, `☕ ${item.name} · ${item.amharicName}\n${item.price} ${t2(lang, "ብር", "ETB")}${left <= 0 ? t2(lang, " · ዛሬ አልቋል", " · sold out today") : ""}`);
        const w = await sendItemWidget(chatId, item.id);
        notes.push({ action: "show_item", ok: photo.ok || w.ok, detail: w.ok ? undefined : `widget: ${w.reason}` });
      } else if (a.type === "cart") {
        const r = await refreshCartWidget(chatId, userId, "resend");
        notes.push({ action: "cart", ok: r.ok, detail: r.reason });
      } else if (a.type === "show_more") {
        const r = await sendText(chatId, t2(lang, "ሙሉ ሜኑው፣ ፎቶና ዝርዝሩ ይኸው 👇", "The full menu, photos and details are here 👇"), miniAppKeyboard(t2(lang, "☕ ሙሉ ሜኑ", "☕ Full menu")));
        notes.push({ action: "show_more", ok: r.ok, detail: r.reason });
      } else if (a.type === "checkout") {
        const r = await sendCartInvoice(userId, chatId);
        if (!r.ok) {
          const msg =
            r.reason === "empty"
              ? t2(lang, "ካርቱ ባዶ ነው — ምን ይሁን? ☕", "Your cart is empty — tell me what you'd like first ☕")
              : r.reason === "stock"
                ? `${r.detail ?? ""} ${t2(lang, "ሌላ ምን ይሁን?", "What else can I get you?")}`.trim()
                : r.reason === "need_address"
                  ? t2(lang, "አድራሻው የት ነው? 📍", "Where should we deliver? Send me your address 📍")
                  : t2(lang, "ይቅርታ፣ ክፍያውን መላክ አልቻልኩም 😕 እንደገና ሞክሩ።", "Sorry, I couldn't send the payment. Please try again.");
          await sendText(chatId, msg);
        }
        notes.push({ action: "checkout", ok: r.ok, detail: r.ok ? `${r.stars} Stars` : r.reason });
      }
    } catch (e) {
      notes.push({ action: a.type, ok: false, detail: e instanceof Error ? e.message : "error" });
    }
  }
  return notes;
}
