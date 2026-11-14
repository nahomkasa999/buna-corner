// End-to-end bot wiring check: feeds real Telegram-shaped updates through the
// grammY handlers in bot/bot.ts (the same dispatcher the webhook uses) with
// every outgoing Bot API call recorded instead of sent. No key/token/network.
// Run: npx tsx scripts/test-bot.ts   Exits non-zero on any failure.
process.env.BOT_TOKEN = "test-token";
delete process.env.GEMINI_API_KEY;

const rec: { method: string; payload: Record<string, any> }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = String(url).split("/").pop() as string;
  rec.push({ method, payload: JSON.parse(String(init?.body ?? "{}")) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 500 + rec.length } }), { status: 200 });
}) as typeof fetch;

import { createBot } from "../bot/bot";
import { getOrders, getStock } from "../lib/store";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
const by = (m: string) => rec.filter((r) => r.method === m);

let updateId = 1;
const from = { id: 777, is_bot: false, first_name: "Nahom", language_code: "en" };
const chat = { id: 777, type: "private" as const, first_name: "Nahom" };
const msg = (text: string, entities?: unknown[]) => ({
  update_id: updateId++,
  message: { message_id: updateId, date: 0, chat, from, text, ...(entities ? { entities } : {}) },
});

async function main(): Promise<void> {
  const bot = createBot()!;
  bot.botInfo = { id: 1, is_bot: true, first_name: "Buna", username: "bunabot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as never;
  // grammY uses its own node-fetch: record its outgoing calls with a transformer.
  bot.api.config.use(async (_prev, method, payload) => {
    rec.push({ method, payload: payload as Record<string, any> });
    return { ok: true, result: method === "answerPreCheckoutQuery" ? true : { message_id: 500 + rec.length, date: 0, chat } } as never;
  });
  await bot.init();

  // /start -> exactly one plain message, no keyboard, no Telegram first name
  await bot.handleUpdate(msg("/start", [{ type: "bot_command", offset: 0, length: 6 }]) as never);
  const greet = by("sendMessage")[0]?.payload;
  check("/start sends one message", by("sendMessage").length === 1);
  check("/start is the Amharic selam", String(greet?.text).startsWith("ሰላም"));
  check("/start has no buttons", !greet?.reply_markup);
  check("/start doesn't use first name", !String(greet?.text).includes("Nahom"));

  // a conversation: replies carry no keyboard; item question -> widget; name asked on turn 3
  rec.length = 0;
  await bot.handleUpdate(msg("hello, what do you recommend?") as never);
  check("reply has no inline keyboard", !by("sendMessage")[0]?.payload.reply_markup);
  check("sends a typing indicator", by("sendChatAction").some((r) => r.payload.action === "typing"));
  await bot.handleUpdate(msg("tell me about the macchiato") as never);
  check("item question -> sendWidget", by("sendWidget").length === 1 && by("sendWidget")[0].payload.html.includes("Macchiato"));
  await bot.handleUpdate(msg("nice, I want a medium macchiato") as never);
  check("name question appears by turn 3", /your name|ስምዎ ማን/.test(String(by("sendMessage").at(-1)?.payload.text)));
  await bot.handleUpdate(msg("Nahom") as never);
  check("greets by the name they gave", /Nahom/.test(String(by("sendMessage").at(-1)?.payload.text)));

  // pay -> invoice in chat
  await bot.handleUpdate(msg("that's all, I'll pay") as never);
  const inv = by("sendInvoice").at(-1)!.payload;
  check("pay -> Stars invoice sent in the chat", inv.currency === "XTR" && inv.chat_id === 777 && inv.prices[0].amount === 44);

  // Telegram asks to confirm -> we approve
  await bot.handleUpdate({ update_id: updateId++, pre_checkout_query: { id: "pcq1", from, currency: "XTR", total_amount: 44, invoice_payload: inv.payload } } as never);
  const ans = by("answerPreCheckoutQuery").at(-1)?.payload;
  check("pre_checkout approved", ans?.ok === true && ans.pre_checkout_query_id === "pcq1");
  await bot.handleUpdate({ update_id: updateId++, pre_checkout_query: { id: "pcq2", from, currency: "XTR", total_amount: 1, invoice_payload: inv.payload } } as never);
  check("tampered amount rejected with a message", by("answerPreCheckoutQuery").at(-1)?.payload.ok === false && !!by("answerPreCheckoutQuery").at(-1)?.payload.error_message);

  // payment lands -> order, thanks, tracker widget
  const stockBefore = getStock("macchiato")!.qty;
  const paymentUpdate = {
    update_id: updateId++,
    message: { message_id: 900, date: 0, chat, from, successful_payment: { currency: "XTR", total_amount: 44, invoice_payload: inv.payload, telegram_payment_charge_id: "tg_chg_1", provider_payment_charge_id: "" } },
  };
  rec.length = 0;
  await bot.handleUpdate(paymentUpdate as never);
  await new Promise((r) => setTimeout(r, 30)); // fire-and-forget tracker widget
  const orders = getOrders(777);
  check("paid order created", orders.length === 1 && orders[0].paymentStatus === "paid" && orders[0].paymentMethod === "stars");
  check("thank-you sent in chat", /ክፍያዎ ደርሶናል/.test(String(by("sendMessage")[0]?.payload.text)) && /Nahom/.test(String(by("sendMessage")[0]?.payload.text)));
  check("order tracker widget sent", by("sendWidget").some((r) => String(r.payload.html).includes(orders[0].id)));
  check("stock decremented", getStock("macchiato")!.qty === stockBefore - 1);

  // Telegram redelivers the same update -> still one order
  rec.length = 0;
  await bot.handleUpdate({ ...paymentUpdate, update_id: updateId++ } as never);
  check("redelivered payment: still one order, no 2nd thank-you", getOrders(777).length === 1 && by("sendMessage").length === 0);

  // explicit "see more" is the only time we link the Mini App
  rec.length = 0;
  await bot.handleUpdate(msg("can I see the full menu with photos?") as never);
  const link = by("sendMessage").at(-1)?.payload;
  check("'full menu' -> one Mini App link button", link?.reply_markup?.inline_keyboard?.flat().length === 1);

  console.log(failures === 0 ? "\nALL BOT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
