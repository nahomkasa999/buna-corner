import { Bot, InlineKeyboard } from "grammy";
import { getMenuItem, getOrder } from "../lib/store";

let botInstance: Bot | null = null;

export function botUsername(): string {
  return process.env.BOT_USERNAME || process.env.NEXT_PUBLIC_BOT_USERNAME || "Alerter_nazbot";
}

export function shopUrl(startapp?: string): string {
  const base = `https://t.me/${botUsername()}/shop`;
  return startapp ? `${base}?startapp=${encodeURIComponent(startapp)}` : base;
}

export function createBot(): Bot | null {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  if (botInstance) return botInstance;
  const bot = new Bot(token);
  const webAppUrl = process.env.NEXT_PUBLIC_APP_URL || "";

  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim() || "";
    const kb = new InlineKeyboard().webApp("☕ Open Buna Corner", webAppUrl || shopUrl());
    let text = "☕ Welcome to *Buna Corner* — Addis Ababa!\n\nFresh Yirgacheffe, traditional jebena buna, and beans roasted in-house. Tap below to open the shop.";
    if (payload.startsWith("ref_")) text += `\n\n🎁 You were invited by a friend — you both get a free drink on your first order!`;
    if (payload.startsWith("item_")) {
      const item = getMenuItem(payload.replace("item_", ""));
      if (item) text = `☕ *${item.name}*\n${item.description}\n\n${item.price} ETB — tap below to order it.`;
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

  bot.on("message:text", async (ctx) => {
    await ctx.reply("☕ Hi! Tap below to open Buna Corner and order:", {
      reply_markup: new InlineKeyboard().webApp("Open Buna Corner", webAppUrl || shopUrl()),
    });
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
