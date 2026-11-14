import { Bot, InlineKeyboard } from "grammy";
import { getMenuItem, getOrCreateUserMemory, getOrder, getOrders, getInventory } from "../lib/store";
import { runDeliveryActions, salesTurn, startGreeting } from "../lib/agent";
import { completePayment, sendCartInvoice, validatePreCheckout } from "../lib/checkout";
import { sendItemWidget, sendOrderTrackerWidget } from "../lib/widget";
import { botUsername, miniAppKeyboard, shopUrl, tgCall } from "../lib/tg";

export { botUsername, shopUrl };

let botInstance: Bot | null = null;

/**
 * The bot is a salesperson, not a menu: customers just talk to it in the
 * chat. No inline keyboards on replies; the only buttons are the Stars pay
 * button on the invoice, the item widget (Bot API 10.4) when they ask about a
 * product, and a single "Full menu" link when they ask to see more.
 */
export function createBot(): Bot | null {
  const token = process.env.BOT_TOKEN;
  if (!token) return null;
  if (botInstance) return botInstance;
  const bot = new Bot(token);

  // /start -> just say selam (Amharic). No buttons, no name yet — the AI asks
  // for the name naturally after a few messages.
  bot.command("start", async (ctx) => {
    const payload = ctx.match?.trim() || "";
    const userId = ctx.from?.id ?? 0;
    await ctx.reply(startGreeting(userId, ctx.from?.first_name ?? "friend"));
    if (payload.startsWith("ref_")) {
      await ctx.reply("🎁 ጓደኛዎ ጋብዘውዎታል — የመጀመሪያ ትዕዛዝዎ ላይ ነፃ መጠጥ ያገኛሉ!");
    }
    if (payload.startsWith("item_")) {
      const item = getMenuItem(payload.replace("item_", ""));
      if (item) sendItemWidget(ctx.chat.id, item.id).catch(() => undefined);
    }
  });

  // Plain-text order status — the live tracker widget is sent on every paid order.
  bot.command("orders", async (ctx) => {
    const mine = getOrders(ctx.from?.id).slice(0, 3);
    if (mine.length === 0) {
      await ctx.reply("እስካሁን ምንም ትዕዛዝ የለዎትም — ምን ልጠጣልዎት? ☕");
      return;
    }
    await ctx.reply(mine.map((o) => `${o.id} — ${o.status} — ${o.total} ETB`).join("\n"));
  });

  // Explicit "see more" — the one place a link to the Mini App is the answer.
  bot.command("shop", async (ctx) => {
    await ctx.reply("ሙሉ ምናሌውን፣ ፎቶዎችንና ዝርዝሩን እዚህ ያገኛሉ 👇", {
      reply_markup: miniAppKeyboard("☕ ሙሉ ምናሌ") as never,
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
    await ctx.reply(`📦 Inventory\n\n${lines.join("\n")}`);
  });

  // /checkout -> straight to the in-chat Stars invoice for whatever is in the cart.
  bot.command("checkout", async (ctx) => {
    const r = await sendCartInvoice(ctx.from?.id ?? 0, ctx.chat.id);
    if (!r.ok) {
      await ctx.reply(
        r.reason === "empty" ? "ጋሪዎ ባዶ ነው — ምን ልጠጣልዎት? ☕" : r.reason === "stock" ? r.detail ?? "Something is sold out" : r.reason === "need_address" ? "ወደ የት ልላክልዎት? አድራሻዎን ይጻፉልኝ 📍" : "ይቅርታ፣ ክፍያውን መላክ አልቻልኩም።",
      );
    }
  });

  // ---- payments (Telegram Stars) ----

  bot.on("pre_checkout_query", async (ctx) => {
    const q = ctx.preCheckoutQuery;
    const v = validatePreCheckout({ currency: q.currency, total_amount: q.total_amount, invoice_payload: q.invoice_payload });
    // Must answer within 10 seconds — validation is synchronous and instant.
    if (v.ok) await ctx.answerPreCheckoutQuery(true);
    else await ctx.answerPreCheckoutQuery(false, v.message);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const p = ctx.message.successful_payment;
    const userId = ctx.from.id;
    const done = completePayment(
      { id: userId, first_name: ctx.from.first_name },
      {
        currency: p.currency,
        total_amount: p.total_amount,
        invoice_payload: p.invoice_payload,
        telegram_payment_charge_id: p.telegram_payment_charge_id,
      },
    );
    if (!done.ok) {
      // Money was taken but we can't find the order (e.g. state lost on a redeploy): give it back.
      await tgCall("refundStarPayment", { user_id: userId, telegram_payment_charge_id: p.telegram_payment_charge_id });
      await ctx.reply("ይቅርታ፣ ትዕዛዝዎን ማግኘት አልቻልኩም — ክፍያዎ ተመልሶልዎታል። እባክዎ እንደገና ይሞክሩ 🙏");
      return;
    }
    if (done.duplicate) return;
    const { order } = done;
    const mem = getOrCreateUserMemory(userId);
    const who = mem.callName ? `${mem.callName}፣ ` : "";
    const where = order.fulfillment === "delivery" ? `ወደ ${order.address ?? "አድራሻዎ"} እናደርሳለን 🛵` : "ሲዘጋጅ እናሳውቅዎታለን — ቡና ኮርነር፣ ቦሌ ይውሰዱ ☕";
    await ctx.reply(`${who}አመሰግናለሁ! ክፍያዎ ደርሶናል ✅\nትዕዛዝ ${order.id} ተቀብለናል — ${where}`);
    notifyOwnerNewOrder(order.id).catch(() => undefined);
    sendOrderTrackerWidget(order.id).catch(() => undefined);
  });

  // ---- everything else is a conversation with the salesperson ----

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from?.id ?? 0;
    ctx.replyWithChatAction("typing").catch(() => undefined);
    try {
      const r = await salesTurn(userId, ctx.from?.first_name ?? "friend", text);
      await ctx.reply(r.reply);
      if (r.deliver.length) await runDeliveryActions(ctx.chat.id, userId, r.deliver, r.lang);
    } catch {
      await ctx.reply("☕ ይቅርታ፣ ትንሽ ተቸገርኩ — እባክዎ እንደገና ይጻፉልኝ።");
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
    await bot.api.sendMessage(
      order.userId,
      `${statusEmoji[order.status] ?? "☕"} Order ${order.id} — ${order.status}\n\n${order.lines.map((l) => `• ${l.qty}× ${l.name}`).join("\n")}\nTotal: ${order.total} ETB`,
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
