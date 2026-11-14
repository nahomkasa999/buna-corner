import { Bot, InlineKeyboard } from "grammy";
import { getMenuItem, getOrder } from "../lib/store";
import { getOrCreateUserMemory } from "../lib/store";
import { getInventory, createDraft } from "../lib/store";
import { chatWithMemory, findMentionedItem, greetUser } from "../lib/ai";
import { sendItemWidget } from "../lib/widget";

let botInstance: Bot | null = null;

export function botUsername(): string {
  return process.env.BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Alerter_nazbot";
}

export function shopUrl(startapp?: string): string {
  const base = `https://t.me/${botUsername()}/shop`;
  return startapp ? `${base}?startapp=${encodeURIComponent(startapp)}` : base;
}

/** "Yes, order it" / "confirm" / "እሺ" style confirmations in bot chat. */
export function isConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(yes|yeah|ok|okay|confirm|order it|place it|do it|እሺ|አዝዝ|ይሁን|አዎ|እወድ)[!. ]*$/.test(t)
    || t.includes("order it") || t.includes("confirm my order") || t.includes("አዝዝ");
}

/**
 * Build a checkout draft from what the AI remembers the customer likes
 * (favourite item, 1×) and the checkout card for it: order summary +
 * "Checkout & Pay" web_app button opening the Mini App at checkout with
 * the draft prefilled, plus an "Open shop" button.
 */
export async function buildCheckoutMessage(userId: number, webAppUrl: string): Promise<{ text: string; kb: InlineKeyboard }> {
  const mem = getOrCreateUserMemory(userId);
  const favId = mem.prefs.favourites[0];
  const item = favId ? getMenuItem(favId) : undefined;
  const shop = webAppUrl || shopUrl();
  if (!item) {
    return {
      text: "What would you like to order? Tell me — e.g. *a macchiato* — or tap below to browse the menu.",
      kb: new InlineKeyboard().webApp("☕ Open shop", shop),
    };
  }
  const draft = createDraft(userId, [{ id: item.id, name: item.name, qty: 1, unitPrice: item.price, options: {} }], "pickup");
  const checkoutUrl = webAppUrl ? `${webAppUrl}?view=checkout&draft=${draft.id}` : shopUrl(`checkout_${draft.id}`);
  const kb = webAppUrl
    ? new InlineKeyboard().webApp("🧾 Checkout & Pay", checkoutUrl).row().webApp("🛒 Open shop", shop)
    : new InlineKeyboard().url("🧾 Checkout & Pay", checkoutUrl).row().url("🛒 Open shop", shop);
  return {
    text: `🧾 *Your order*\n\n• 1× ${item.name} — ${item.price} ETB\n\nTotal: *${item.price} ETB* (pickup)\nTap below to check out and pay.`,
    kb,
  };
}

export function createBot(): Bot | null {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  if (botInstance) return botInstance;
  const bot = new Bot(token);
  const webAppUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim() || "";
    const shop = webAppUrl || shopUrl();
    const kb = new InlineKeyboard()
      .webApp("☕ Order", shop)
      .row()
      .webApp("💬 Ask Buna AI", webAppUrl ? `${webAppUrl}?startapp=ai` : shop);
    // AI greeting (Amharic by default) — falls back to the static greeting
    // in mock mode (no GEMINI_API_KEY) or on any AI error. Never crashes.
    let text: string;
    try {
      const firstName = ctx.from?.first_name ?? "friend";
      const lang = ctx.from?.language_code === "am" ? "am" : undefined;
      const g = await greetUser(ctx.from?.id ?? 0, firstName, lang);
      text = g.reply;
    } catch {
      text = "☕ Welcome to *Buna Corner* — Addis Ababa!\n\nFresh Yirgacheffe, traditional jebena buna, and beans roasted in-house. Tap below to open the shop.";
    }
    if (payload.startsWith("ref_")) text += `\n\n🎁 You were invited by a friend — you both get a free drink on your first order!`;
    if (payload.startsWith("item_")) {
      const item = getMenuItem(payload.replace("item_", ""));
      if (item) {
        text = `☕ *${item.name}*\n${item.description}\n\n${item.price} ETB — tap below to order it.`;
        // Also send the interactive item card (Bot API 10.4 widget).
        sendItemWidget(ctx.chat.id, item.id).catch(() => undefined);
      }
    }
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  });

  bot.command("shop", async (ctx) => {
    await ctx.reply("☕ Open the Buna Corner shop:", {
      reply_markup: new InlineKeyboard().webApp("Open shop", webAppUrl || shopUrl()),
    });
  });

  bot.command("orders", async (ctx) => {
    await ctx.reply("Your orders live in the Mini App — tap below:", {
      reply_markup: new InlineKeyboard().webApp("My orders", webAppUrl || shopUrl()),
    });
  });

  bot.command("stock", async (ctx) => {
    const owner = process.env.OWNER_TELEGRAM_ID;
    if (!owner || String(ctx.from?.id) !== String(owner)) {
      await ctx.reply("This command is for the shop owner only.");
      return;
    }
    const inv = getInventory();
    const lines = inv.map((i) =>
      `${i.qty <= 0 ? "🔴" : i.low ? "🟠" : "🟢"} ${i.name} — ${i.qty} ${i.unit}${i.low && i.qty > 0 ? ` (low — alert at ${i.lowAt})` : ""}${i.qty <= 0 ? " — SOLD OUT" : ""}`,
    );
    await ctx.reply(`📦 *Inventory*\n\n${lines.join("\n")}`);
  });

  bot.command("checkout", async (ctx) => {
    const msg = await buildCheckoutMessage(ctx.from?.id ?? 0, webAppUrl);
    await ctx.reply(msg.text, { parse_mode: "Markdown", reply_markup: msg.kb });
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from?.id ?? 0;
    const firstName = ctx.from?.first_name ?? "friend";
    // "Yes, order it" style confirmation in bot chat -> build a checkout draft
    // from what the AI remembers the customer likes, then send the checkout card.
    if (isConfirmation(text)) {
      const msg = await buildCheckoutMessage(userId, webAppUrl);
      await ctx.reply(msg.text, { parse_mode: "Markdown", reply_markup: msg.kb });
      return;
    }
    // Free-text -> the AI barista (same memory as the Mini App for this user).
    try {
      const lang = ctx.from?.language_code === "am" ? "am" : undefined;
      const r = await chatWithMemory(userId, firstName, text, lang);
      await ctx.reply(r.reply, {
        reply_markup: new InlineKeyboard().webApp("☕ Open shop", webAppUrl || shopUrl()),
      });
      // Asked about a specific item ("tell me about macchiato", "I like X")?
      // Send its interactive card (Bot API 10.4 widget) right after the text.
      const mentioned = findMentionedItem(text);
      if (mentioned) sendItemWidget(ctx.chat.id, mentioned.id).catch(() => undefined);
    } catch {
      await ctx.reply("☕ Hi! Tap below to open Buna Corner and order:", {
        reply_markup: new InlineKeyboard().webApp("Open Buna Corner", webAppUrl || shopUrl()),
      });
    }
  });

  botInstance = bot;
  return bot;
}

/** Notify a user about an order status change (fire-and-forget safe). */
export async function notifyOrderStatus(orderId: string): Promise<boolean> {
  try {
    const bot = createBot();
    const order = getOrder(orderId);
    if (!bot || !order) return false;
    const statusEmoji: Record<string, string> = { Received: "📥", Brewing: "☕", Ready: "✅", "Out for delivery": "🛵", Completed: "🎉", Cancelled: "❌" };
    const kb = new InlineKeyboard().webApp("Track order", process.env.NEXT_PUBLIC_APP_URL || shopUrl());
    await bot.api.sendMessage(
      order.userId,
      `${statusEmoji[order.status] ?? "☕"} *Order ${order.id}* — ${order.status}\n\n${order.lines.map((l) => `• ${l.qty}× ${l.name}`).join("\n")}\nTotal: ${order.total} ETB`,
      { parse_mode: "Markdown", reply_markup: kb },
    );
    return true;
  } catch { return false; }
}

/** Notify the owner about a new order (fire-and-forget safe). */
export async function notifyOwnerNewOrder(orderId: string): Promise<boolean> {
  try {
    const bot = createBot();
    const owner = process.env.OWNER_TELEGRAM_ID;
    const order = getOrder(orderId);
    if (!bot || !owner || !order) return false;
    const kb = new InlineKeyboard().webApp("Open owner dashboard", process.env.NEXT_PUBLIC_APP_URL || shopUrl());
    await bot.api.sendMessage(
      Number(owner),
      `🔔 *New order ${order.id}*\n${order.userName} — ${order.fulfillment}\n${order.lines.map((l) => `• ${l.qty}× ${l.name} (${l.unitPrice} ETB)`).join("\n")}\nTotal: *${order.total} ETB*${order.notes ? `\nNotes: ${order.notes}` : ""}`,
      { parse_mode: "Markdown", reply_markup: kb },
    );
    return true;
  } catch { return false; }
}

export async function postItemToChannel(itemId: string, channelId?: string): Promise<{ ok: boolean; reason?: string }> {
  const bot = createBot();
  const item = getMenuItem(itemId);
  if (!item) return { ok: false, reason: "Item not found" };
  if (!bot) return { ok: false, reason: "BOT_TOKEN not configured" };
  const target = channelId || process.env.CHANNEL_ID;
  if (!target) return { ok: false, reason: "CHANNEL_ID not configured" };
  try {
    const kb = new InlineKeyboard().webApp("🛒 Order now", shopUrl(`item_${item.id}`));
    await bot.api.sendPhoto(target, item.image, {
      caption: `☕ *${item.name}* — ${item.price} ETB\n${item.description}\n\n📍 Buna Corner, Addis Ababa`,
      parse_mode: "Markdown", reply_markup: kb,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Telegram send failed" };
  }
}
