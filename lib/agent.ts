// Buna AI as a SALESPERSON living entirely inside the Telegram chat.
//
// The customer just talks. There are no button menus: the agent chats like a
// person, asks the customer's name after a few turns, shows an item's HTML
// widget (Bot API 10.4) when they ask about a specific product, builds their
// cart, takes payment in the chat (Telegram Stars invoice) and refers them to
// the Mini App ONLY when they want to see more.
//
// The model answers with JSON {reply, actions}. Actions are validated here
// (item exists, stock, sizes, quantities) — the model proposes, the server
// decides. Without GEMINI_API_KEY (or on any AI error) a rule-based mock
// salesperson answers instead, so the bot never goes silent or crashes.

import { z } from "zod";
import { MENU_ITEMS } from "./data";
import {
  aiConfigured,
  CHAT_FALLBACK_MODEL,
  CHAT_MODEL,
  findMentionedItem,
  getClient,
  inStockPopular,
  stockContext,
  type AiLang,
} from "./ai";
import {
  addToWidgetDraft,
  appendTurn,
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
  type OrderLine,
  type UserMemory,
} from "./store";
import { draftTotals, sendCartInvoice, starsFor } from "./checkout";
import { sendItemWidget, SIZE_DELTA, SIZE_LABEL } from "./widget";
import { miniAppKeyboard, sendText } from "./tg";

// ---------- actions the model may propose ----------

const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("show_item"), id: z.string() }),
  z.object({
    type: z.literal("add_to_cart"),
    id: z.string(),
    size: z.enum(["S", "M", "L"]).optional(),
    qty: z.number().int().min(1).max(10).optional(),
  }),
  z.object({ type: z.literal("remove_from_cart"), id: z.string() }),
  z.object({ type: z.literal("set_delivery"), fulfillment: z.enum(["pickup", "delivery"]), address: z.string().max(200).optional() }),
  z.object({ type: z.literal("checkout") }),
  z.object({ type: z.literal("show_more") }),
]);
export type AgentAction = z.infer<typeof ActionSchema>;

/** Parse the model's JSON leniently: keep a string reply, drop only invalid actions. */
export function parseAgentJson(raw: string): { reply: string; actions: AgentAction[] } | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as { reply?: unknown; actions?: unknown };
  if (typeof o.reply !== "string" || !o.reply.trim()) return null;
  const actions: AgentAction[] = [];
  if (Array.isArray(o.actions)) {
    for (const a of o.actions) {
      const p = ActionSchema.safeParse(a);
      if (p.success) actions.push(p.data);
    }
  }
  return { reply: o.reply.trim(), actions };
}

// ---------- language ----------

const EN_WORDS = /\b(the|i|want|a|an|please|hello|hi|hey|can|what|how|do|you|is|it|my|me|to|for|with|and|have|would|like|thanks|thank|yes|no)\b/gi;
const LATIN_AM = /(selam|salam|endemen|indemen|betam|ameseginalehu|amesegnalehu|dehna|buna|shai|ewo)/i;

/** Ethiopic -> am; clearly English -> en; otherwise keep the previous language. */
export function pickLang(text: string, prev: AiLang): AiLang {
  if (/[ሀ-፼]/.test(text)) return "am";
  if ((text.match(EN_WORDS) ?? []).length >= 2) return "en";
  if (LATIN_AM.test(text)) return "am";
  return prev;
}

// ---------- intent helpers (mock mode + name guard) ----------

const PAY_EN = /\b(pay|checkout|check out|invoice|that'?s all|thats all|i'?m done|im done)\b/i;
const PAY_AM = /ክፈል|ልክፈል|ክፍያ|ጨርሻለሁ|ይበቃል|ይበቃኛል/;
const CONFIRM = /^(yes|yeah|yep|ok|okay|sure|confirm|order it|place it|do it|እሺ|አዝዝ|ይሁን|አዎ|አዎን)[!. ]*$/i;
const BUY_EN = /\b(order|add|want|get|take|buy|give me|i'?ll have|i will have)\b/i;
const BUY_AM = /እፈልጋለሁ|አዝዝ|ስጠኝ|እወስዳለሁ|ጨምር|ልውሰድ|እሻለሁ|ላክልኝ/;
// "see more" wants: STRONG ones win even when an item is named; WEAK ones
// ("tell me more about croissant") should show that item's card instead.
const MORE_STRONG = /\b(full menu|everything|all (the )?items|photos?|pictures?)\b|ሙሉ ምናሌ|ሁሉንም|ፎቶ/i;
const MORE_WEAK = /\b(menu|details?|more (info|about|options|items))\b|ምናሌ|ዝርዝር|ተጨማሪ/i;
const DELIVERY_EN = /\b(deliver|delivery)\b/i;
const DELIVERY_AM = /ማድረስ|ይድረሰኝ|አድርሱልኝ|ዴሊቨሪ/;

export const wantsPay = (t: string) => PAY_EN.test(t) || PAY_AM.test(t);
export const isConfirmation = (t: string) => CONFIRM.test(t.trim());
const wantsToBuy = (t: string) => BUY_EN.test(t) || BUY_AM.test(t);
const wantsMoreStrong = (t: string) => MORE_STRONG.test(t);
const wantsMore = (t: string) => MORE_STRONG.test(t) || MORE_WEAK.test(t);
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

const NOT_NAMES = /^(yes|yeah|yep|no|nope|ok|okay|hi|hello|hey|thanks|thank you|please|menu|more|pay|checkout|selam|ሰላም|እሺ|አዎ|አይ|አመሰግናለሁ)$/i;
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

// ---------- prompt ----------

function menuWithIds(): string {
  return MENU_ITEMS.filter((m) => !m.hidden)
    .map((m) => {
      const sized = m.options?.some((g) => g.name === "Size") ? " [sizes S/M +30/L +60]" : "";
      return `- id=${m.id} · ${m.name} (${m.amharicName}) — ${m.price} ETB, ${m.category}${sized}: ${m.description}`;
    })
    .join("\n");
}

function cartSummary(userId: number): string {
  const cart = getCart(userId);
  if (!cart) return "empty";
  const { total, deliveryFee } = draftTotals(cart);
  const lines = cart.lines
    .map((l) => `${l.qty}× ${l.name}${l.options?.Size ? ` (${l.options.Size})` : ""} = ${l.qty * l.unitPrice} ETB`)
    .join("; ");
  const ful = cart.fulfillment === "delivery" ? `delivery (+${deliveryFee} ETB, address: ${cart.address ?? "NOT GIVEN YET"})` : "pickup";
  return `${lines}. Total ${total} ETB = ${starsFor(total)} Stars. Fulfilment: ${ful}`;
}

function systemPrompt(mem: UserMemory, userId: number, opts: { askName: boolean; justSavedName?: string; lang: AiLang }): string {
  const nameLine = mem.callName
    ? `The customer's name is ${mem.callName} — use it now and then, not in every message.`
    : "You don't know the customer's name yet. Do NOT call them by their Telegram name.";
  return `You are Buna AI, the friendly barista and salesperson of Buna Corner, a coffee shop in Addis Ababa (Bole). You are chatting with a customer in a Telegram DM — the whole sale happens right here in this chat. Write like a real person texting: warm, a little playful, 1-3 SHORT sentences, plain text (no markdown, no bullet lists, no headings). Speak ${opts.lang === "am" ? "Amharic" : "English"} (switch if the customer switches). The conversation already started with a greeting ("ሰላም!") — never greet again.

HOW YOU SELL
- Talk, don't present options. Never list the menu, never say "tap", "click" or "press a button". Ask at most ONE question per message.
- Recommend one or two things that fit what they say; upsell gently (bigger size, a pastry pairing, beans to take home).
- Never invent items or prices. Never sell a sold-out item — suggest an in-stock alternative from the same category.
- When the customer asks about a specific product, describe it in a sentence or two AND add {"type":"show_item","id":"<id>"} — the product's interactive card then appears in the chat.
- When they clearly want something, add {"type":"add_to_cart","id":"<id>","size":"S|M|L","qty":1}. Size only for items marked with sizes (default S). Do not add anything they haven't asked for.
- When they're ready to pay (or say that's all), confirm the order in a sentence and add {"type":"checkout"}: a Telegram payment invoice (Telegram Stars) appears in the chat and they pay right there. Prices are in ETB; the invoice shows the Stars amount.
- Delivery costs 50 ETB (pickup is free). If they want delivery use {"type":"set_delivery","fulfillment":"delivery","address":"..."} and ask for their address if you don't have it; "pickup" otherwise.
- ONLY when they ask to see more (full menu, photos, every detail), add {"type":"show_more"} — that sends a link to our Mini App. Never offer it otherwise.
- {"type":"remove_from_cart","id":"<id>"} removes an item they changed their mind about.
- If asked whether you're a bot: be honest that you're Buna Corner's AI assistant, still friendly.
${opts.askName ? "- Somewhere natural in THIS reply, ask for the customer's name (one short question at the end).\n" : ""}${opts.justSavedName ? `- The customer just told you their name: ${opts.justSavedName}. Acknowledge it warmly in a few words.\n` : ""}
OUTPUT: reply with ONLY a JSON object {"reply": "<your chat message>", "actions": [ ...zero or more actions... ]}. Actions may only be the types above.

MENU:
${menuWithIds()}

LIVE STOCK:
${stockContext()}

CUSTOMER
- ${nameLine}
- Past orders: ${mem.prefs.orderCount}
- Favourites: ${mem.prefs.favourites.map((id) => getMenuItem(id)?.name).filter(Boolean).slice(0, 3).join(", ") || "none yet"}
- Current cart: ${cartSummary(userId)}

Sizes add +30 ETB (Medium) / +60 ETB (Large). Every 8th coffee is free (stamp card). Beans of the Month is 900 ETB/month.`;
}

async function liveTurn(mem: UserMemory, userId: number, opts: { askName: boolean; justSavedName?: string; lang: AiLang }) {
  const ai = getClient();
  if (!ai) throw new Error("AI not configured");
  const turns = mem.history.map((t) => ({
    role: t.role === "ai" ? ("model" as const) : ("user" as const),
    parts: [{ text: t.text }],
  }));
  while (turns.length && turns[0].role === "model") turns.shift(); // Gemini wants a user turn first
  let lastErr: unknown;
  for (const model of [CHAT_MODEL, CHAT_FALLBACK_MODEL]) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: turns,
        config: {
          systemInstruction: systemPrompt(mem, userId, opts),
          responseMimeType: "application/json",
          maxOutputTokens: 700,
          temperature: 0.8,
        },
      });
      const parsed = parseAgentJson(res.text ?? "");
      if (parsed) return parsed;
      // The model ignored the JSON contract but wrote something usable: send it as a plain reply.
      const plain = res.text?.trim();
      if (plain && !plain.startsWith("{")) return { reply: plain, actions: [] as AgentAction[] };
      lastErr = new Error("unparseable reply");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gemini failed");
}

// ---------- mock salesperson (no key / AI error) ----------

const t2 = (lang: AiLang, am: string, en: string) => (lang === "am" ? am : en);

function mockTurn(userId: number, text: string, lang: AiLang): { reply: string; actions: AgentAction[] } {
  const cart = getCart(userId);

  if (wantsMoreStrong(text) || (wantsMore(text) && !findMentionedItem(text))) {
    return {
      reply: t2(lang, "በደስታ! ሙሉ ምናሌውን ከፎቶና ዝርዝር ጋር ከታች ልላክልዎት 👇", "Of course! Here's the full menu with photos and details 👇"),
      actions: [{ type: "show_more" }],
    };
  }

  // They chose delivery and we're waiting for the address: this message is it.
  if (cart?.fulfillment === "delivery" && !cart.address && !wantsPay(text) && !isConfirmation(text)) {
    return {
      reply: t2(lang, "አድራሻዎን ተቀብያለሁ 📍 ክፍያውን ልላክልዎት ወይስ ሌላ ነገር ይጨምሩ?", "Got your address 📍 Shall I send the payment, or add something else?"),
      actions: [{ type: "set_delivery", fulfillment: "delivery", address: text.trim().slice(0, 200) }],
    };
  }

  const item = findMentionedItem(text);
  if (item) {
    const left = stockLeft(item.id);
    if (left <= 0 || item.soldOut) {
      const alt = MENU_ITEMS.find((m) => m.category === item.category && m.id !== item.id && !m.hidden && stockLeft(m.id) > 0) ?? inStockPopular(1)[0];
      return {
        reply: t2(
          lang,
          `ይቅርታ፣ ${item.name} ዛሬ አልቋል።${alt ? ` ${alt.name} (${alt.price} ብር) ልሞክርልዎት? በጣም ጣፋጭ ነው።` : ""}`,
          `Sorry, ${item.name} is sold out today.${alt ? ` Want ${alt.name} (${alt.price} ETB) instead? It's lovely.` : ""}`,
        ),
        actions: alt ? [{ type: "show_item", id: alt.id }] : [],
      };
    }
    if (wantsToBuy(text)) {
      const size = sizeFrom(text);
      const qty = qtyFrom(text);
      const hasSize = item.options?.some((g) => g.name === "Size");
      return {
        reply: t2(
          lang,
          `${qty > 1 ? `${qty}×` : ""} ${item.name}${hasSize && size ? ` (${SIZE_LABEL[size]})` : ""} ጨምሬያለሁ ✅ ሌላ ነገር ይፈልጋሉ ወይስ ክፍያውን ልላክልዎት?`,
          `Added ${qty > 1 ? `${qty}× ` : ""}${item.name}${hasSize && size ? ` (${SIZE_LABEL[size]})` : ""} ✅ Anything else, or shall I send the payment?`,
        ),
        actions: [{ type: "add_to_cart", id: item.id, size, qty }],
      };
    }
    return {
      reply: t2(
        lang,
        `${item.name} አለን! ${item.price} ብር ነው — ${item.description} ልጨምርልዎት?`,
        `Yes, we have ${item.name} — ${item.price} ETB. ${item.description} Shall I add one for you?`,
      ),
      actions: [{ type: "show_item", id: item.id }],
    };
  }

  if (wantsDelivery(text)) {
    return {
      reply: t2(lang, "እናደርስልዎታለን! (ማድረስ 50 ብር ነው) አድራሻዎን ይጻፉልኝ 📍", "We deliver! (50 ETB) Send me your address 📍"),
      actions: [{ type: "set_delivery", fulfillment: "delivery" }],
    };
  }

  if (wantsPay(text) || (isConfirmation(text) && cart)) {
    if (!cart) {
      return { reply: t2(lang, "ጋሪዎ ባዶ ነው — መጀመሪያ ምን እንደሚፈልጉ ንገሩኝ ☕", "Your cart is empty — tell me what you'd like first ☕"), actions: [] };
    }
    const total = draftTotals(cart).total;
    return {
      reply: t2(lang, `በጣም ጥሩ! ${total} ብር ነው — ክፍያውን አሁን እልክልዎታለሁ 💳`, `Lovely! That's ${total} ETB — sending your payment now 💳`),
      actions: [{ type: "checkout" }],
    };
  }

  const pick = inStockPopular(1)[0];
  return {
    reply: pick
      ? t2(
          lang,
          `ዛሬ ምን ልጠጣልዎት? ${pick.name} (${pick.price} ብር) በጣም ተወዳጅ ነው ☕`,
          `What can I get you today? ${pick.name} (${pick.price} ETB) is a real favourite ☕`,
        )
      : t2(lang, "ዛሬ ምን ልጠጣልዎት? ☕", "What can I get you today? ☕"),
    actions: [],
  };
}

// ---------- applying the model's state-changing actions (server decides) ----------

function applyStateActions(userId: number, actions: AgentAction[], lang: AiLang): string[] {
  const failures: string[] = [];
  for (const a of actions) {
    if (a.type === "add_to_cart") {
      const item = getMenuItem(a.id);
      if (!item) {
        failures.push(t2(lang, "ይቅርታ፣ ያንን ንጥል አላገኘሁም።", "Sorry, I couldn't find that item."));
        continue;
      }
      const hasSize = !!item.options?.some((g) => g.name === "Size");
      const code = hasSize ? (a.size ?? "S") : "S";
      const qty = a.qty ?? 1;
      const inCart = getCart(userId)?.lines.filter((l) => l.id === item.id).reduce((n, l) => n + l.qty, 0) ?? 0;
      const left = stockLeft(item.id);
      if (left <= 0 || item.soldOut) {
        failures.push(t2(lang, `ይቅርታ፣ ${item.name} ዛሬ አልቋል።`, `Sorry, ${item.name} is sold out today.`));
        continue;
      }
      if (inCart + qty > left) {
        failures.push(t2(lang, `${item.name} የቀረው ${left} ብቻ ነው።`, `Only ${left} ${item.name} left.`));
        continue;
      }
      const line: OrderLine = {
        id: item.id,
        name: item.name,
        qty,
        unitPrice: item.price + (hasSize ? SIZE_DELTA[code] ?? 0 : 0),
        options: hasSize ? { Size: SIZE_LABEL[code] } : {},
        image: item.image,
      };
      addToWidgetDraft(userId, line);
    } else if (a.type === "remove_from_cart") {
      removeFromCart(userId, a.id);
    } else if (a.type === "set_delivery") {
      setCartDelivery(userId, a.fulfillment, a.address?.trim() || undefined);
    }
  }
  return failures;
}

// ---------- one conversational turn ----------

export interface AgentResult {
  reply: string;
  /** Everything the model/mock proposed (state ones are already applied). */
  actions: AgentAction[];
  /** Actions still to run AFTER the reply is sent: show_item, show_more, checkout. */
  deliver: AgentAction[];
  lang: AiLang;
  mock: boolean;
  askedName: boolean;
  savedName?: string;
}

export async function salesTurn(userId: number, tgFirstName: string, text: string, langHint?: AiLang): Promise<AgentResult> {
  const mem = getOrCreateUserMemory(userId, tgFirstName);
  const lang = langHint ?? pickLang(text, mem.prefs.lang);
  setUserLang(userId, lang);
  const turns = noteUserTurn(userId);

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
  appendTurn(userId, "user", text);

  if (savedName && nameOnly) {
    const cart = getCart(userId);
    const reply = t2(
      lang,
      `${savedName}፣ ደስ ብሎኛል! 😊 ${cart ? "ክፍያውን ልላክልዎት ወይስ ሌላ ነገር ይጨምሩ?" : "ዛሬ ምን ልጠጣልዎት?"}`,
      `Nice to meet you, ${savedName}! 😊 ${cart ? "Shall I send the payment, or add something else?" : "What can I get you today?"}`,
    );
    appendTurn(userId, "ai", reply);
    return { reply, actions: [], deliver: [], lang, mock: false, askedName: false, savedName };
  }

  const askName = mem.nameState === "unknown" && turns >= ASK_NAME_AFTER_TURNS && !wantsPay(text);
  const opts = { askName, justSavedName: savedName, lang };

  let out: { reply: string; actions: AgentAction[] };
  let mock = false;
  if (aiConfigured()) {
    try {
      out = await liveTurn(mem, userId, opts);
    } catch {
      out = mockTurn(userId, text, lang);
      mock = true;
    }
  } else {
    out = mockTurn(userId, text, lang);
    mock = true;
  }

  // The mock cannot phrase a natural name question inside its reply, so it appends one.
  let reply = out.reply;
  if (askName && mock) {
    reply += t2(lang, "\n\nለመሆኑ ስምዎ ማን ይባላል? 😊", "\n\nBy the way, what's your name? 😊");
  }
  if (askName) setNameState(userId, "asked");

  // Server-side validation of state changes; tell the customer if one failed.
  const failures = applyStateActions(userId, out.actions, lang);
  if (failures.length) reply += `\n${failures.join(" ")}`;

  const seen = new Set<string>();
  const deliver = out.actions.filter((a) => {
    if (a.type !== "show_item" && a.type !== "show_more" && a.type !== "checkout") return false;
    const key = a.type === "show_item" ? `show_item:${a.id}` : a.type;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  appendTurn(userId, "ai", reply);
  return { reply, actions: out.actions, deliver, lang, mock, askedName: askName, savedName };
}

// ---------- /start greeting (static: just "selam", no buttons, no name yet) ----------

export function startGreeting(userId: number, tgFirstName: string): string {
  const mem = getOrCreateUserMemory(userId, tgFirstName);
  const text = mem.callName
    ? `ሰላም ${mem.callName}! እንኳን ወደ ቡና ኮርነር በደህና ተመለሱ ☕`
    : "ሰላም! እንኳን ወደ ቡና ኮርነር በደህና መጡ ☕";
  appendTurn(userId, "ai", text);
  return text;
}

// ---------- delivering actions in the chat ----------

export interface DeliveryNote { action: string; ok: boolean; detail?: string }

/** Run show_item / show_more / checkout in the customer's chat (never throws). */
export async function runDeliveryActions(chatId: number, userId: number, deliver: AgentAction[], lang: AiLang): Promise<DeliveryNote[]> {
  const notes: DeliveryNote[] = [];
  for (const a of deliver) {
    try {
      if (a.type === "show_item") {
        const r = await sendItemWidget(chatId, a.id);
        notes.push({ action: "show_item", ok: r.ok, detail: r.reason });
      } else if (a.type === "show_more") {
        const r = await sendText(
          chatId,
          t2(lang, "ሙሉ ምናሌውን፣ ፎቶዎችንና ዝርዝሩን እዚህ ያገኛሉ 👇", "The full menu, photos and details are here 👇"),
          miniAppKeyboard(t2(lang, "☕ ሙሉ ምናሌ", "☕ Full menu")),
        );
        notes.push({ action: "show_more", ok: r.ok, detail: r.reason });
      } else if (a.type === "checkout") {
        const r = await sendCartInvoice(userId, chatId);
        if (!r.ok) {
          const msg =
            r.reason === "empty"
              ? t2(lang, "ጋሪዎ ባዶ ነው — መጀመሪያ ምን እንደሚፈልጉ ንገሩኝ ☕", "Your cart is empty — tell me what you'd like first ☕")
              : r.reason === "stock"
                ? `${r.detail ?? ""} ${t2(lang, "ሌላ ምን ልስጥዎት?", "What else can I get you?")}`.trim()
                : r.reason === "need_address"
                  ? t2(lang, "ወደ የት ልላክልዎት? አድራሻዎን ይጻፉልኝ 📍", "Where should we deliver? Send me your address 📍")
                  : t2(lang, "ይቅርታ፣ ክፍያውን መላክ አልቻልኩም። እባክዎ እንደገና ይሞክሩ።", "Sorry, I couldn't send the payment. Please try again.");
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
