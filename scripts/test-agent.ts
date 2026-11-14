// Offline checks for the in-chat salesperson + Stars payment — no key, no
// real token, no network (fetch to api.telegram.org is stubbed).
// Run: npx tsx scripts/test-agent.ts   Exits non-zero on any failure.
process.env.BOT_TOKEN = "test-token";
delete process.env.GEMINI_API_KEY; // mock salesperson
delete process.env.ETB_PER_STAR;
delete process.env.NEXT_PUBLIC_APP_URL;

const calls: { method: string; body: Record<string, any> }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = String(url).split("/").pop() as string;
  calls.push({ method, body: JSON.parse(String(init?.body ?? "{}")) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1000 + calls.length } }), { status: 200 });
}) as typeof fetch;
const sent = (m: string) => calls.filter((c) => c.method === m);

import {
  extractName,
  parseAgentJson,
  pickLang,
  runDeliveryActions,
  salesTurn,
  startGreeting,
} from "../lib/agent";
import { completePayment, sendCartInvoice, starsFor, validatePreCheckout } from "../lib/checkout";
import { handleWidgetQuery } from "../lib/widget";
import { getCart, getDraft, getOrCreateUserMemory, getOrder, setStock, stockLeft } from "../lib/store";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  // --- 1. /start: just selam, no name, no menu ---
  const U = 9001;
  const greet = startGreeting(U, "Telegram-Nahom");
  check("/start greets with selam", greet.startsWith("ሰላም"));
  check("/start does not use the Telegram first name", !greet.includes("Nahom"));

  // --- 2. name is asked only after a few turns, once ---
  const t1 = await salesTurn(U, "Telegram-Nahom", "selam");
  const t2 = await salesTurn(U, "Telegram-Nahom", "what is a macchiato?");
  check("no name question on turns 1-2", !t1.askedName && !t2.askedName);
  check("asking about a product shows its widget", t2.deliver.some((a) => a.type === "show_item" && a.id === "macchiato"));
  const t3 = await salesTurn(U, "Telegram-Nahom", "sounds good, tell me more about croissant");
  check("name asked on turn 3", t3.askedName && /ስምዎ ማን|your name/.test(t3.reply));
  check("name state = asked", getOrCreateUserMemory(U).nameState === "asked");
  check("'more about croissant' shows the croissant card, not the full menu",
    t3.deliver.some((a) => a.type === "show_item" && a.id === "croissant") && !t3.deliver.some((a) => a.type === "show_more"));
  const t4 = await salesTurn(U, "Telegram-Nahom", "Abebe");
  check("bare name saved", t4.savedName === "Abebe" && getOrCreateUserMemory(U).callName === "Abebe");
  check("name reply is a conversation, no actions", t4.deliver.length === 0 && /Abebe/.test(t4.reply));
  const t5 = await salesTurn(U, "Telegram-Nahom", "hello again");
  check("never asks the name twice", !t5.askedName && !/ስምዎ ማን|your name/.test(t5.reply));
  check("returning /start uses the saved name", startGreeting(U, "x").includes("Abebe"));

  // --- 3. name extraction ---
  check("'I'm Abebe' -> Abebe (explicit)", JSON.stringify(extractName("I'm Abebe")) === JSON.stringify({ name: "Abebe", explicit: true }));
  check("'ስሜ አበበ ነው' -> አበበ", extractName("ስሜ አበበ ነው")?.name === "አበበ");
  check("'macchiato' is not a name", extractName("macchiato") === null);
  check("'I'm hungry' is not a name", extractName("I'm hungry") === null);
  check("'yes' is not a name", extractName("yes") === null);
  check("a sentence is not a name", extractName("I want two macchiato please") === null);

  // --- 4. language ---
  check("Ethiopic -> am", pickLang("ሰላም", "en") === "am");
  check("English sentence -> en", pickLang("I want a coffee please", "am") === "en");
  check("'ok' keeps previous language", pickLang("ok", "am") === "am");

  // --- 5. cart building (server applies + validates) ---
  const V = 9002;
  const add = await salesTurn(V, "V", "I want 2 large macchiato");
  const cart = getCart(V);
  check("add intent -> cart line", !!cart && cart.lines.length === 1 && cart.lines[0].qty === 2);
  check("Large macchiato = 80+60 = 140 ETB each", cart?.lines[0].unitPrice === 140 && cart.lines[0].options?.Size === "Large");
  check("add reply doesn't push a button menu", !/tap|click|button/i.test(add.reply));

  const more = await salesTurn(V, "V", "can I see the full menu with photos?");
  check("'see more' -> refer to Mini App", more.deliver.some((a) => a.type === "show_more"));
  const moreNotes = await runDeliveryActions(V, V, more.deliver, "en");
  const moreMsg = sent("sendMessage").at(-1);
  check("show_more sends ONE link button", moreNotes[0].ok && moreMsg?.body.reply_markup.inline_keyboard.flat().length === 1);

  // sold-out guard: model/mock proposes it, server refuses
  setStock("croissant", 0);
  const so = await salesTurn(V, "V", "I want a croissant");
  check("sold-out add refused", !getCart(V)?.lines.some((l) => l.id === "croissant"));
  check("customer is told it's sold out", /sold out|አልቋል/.test(so.reply));
  setStock("croissant", 25);

  // --- 6. delivery needs an address; fee added ---
  const noAddr = await salesTurn(V, "V", "please deliver it");
  check("delivery chosen", getCart(V)?.fulfillment === "delivery");
  const blocked = await sendCartInvoice(V, V);
  check("invoice blocked until address given", !blocked.ok && blocked.reason === "need_address");
  await salesTurn(V, "V", "Bole Atlas, near the bank");
  check("address captured from chat", getCart(V)?.address === "Bole Atlas, near the bank");
  void noAddr;

  // --- 7. pay: Stars invoice in the chat ---
  const before = sent("sendInvoice").length;
  const pay = await salesTurn(V, "V", "that's all, I'll pay");
  check("pay intent -> checkout action", pay.deliver.some((a) => a.type === "checkout"));
  const notes = await runDeliveryActions(V, V, pay.deliver, "en");
  const inv = sent("sendInvoice")[before];
  check("sendInvoice called", notes[0]?.ok === true && !!inv);
  const totalEtb = 2 * 140 + 50;
  check("invoice currency XTR, no provider_token", inv?.body.currency === "XTR" && !("provider_token" in inv.body));
  check("exactly one price line (Stars requirement)", inv?.body.prices.length === 1);
  check("amount = ceil(total/2.5) Stars", inv?.body.prices[0].amount === starsFor(totalEtb) && starsFor(totalEtb) === 132);
  check("payload is an immutable snapshot draft", !!getDraft(inv?.body.payload));
  check("description itemises the order", /2× Ethiopian Macchiato/.test(inv?.body.description) && /330 ETB/.test(inv?.body.description));

  // adding to the cart after the invoice must not change what the invoice pays for
  await salesTurn(V, "V", "add a tea too");
  const snap = getDraft(inv.body.payload)!;
  check("snapshot unaffected by later cart edits", snap.lines.length === 1 && snap.invoiceStars === 132);

  // --- 8. pre-checkout validation ---
  const pre = { currency: "XTR", total_amount: 132, invoice_payload: inv.body.payload };
  check("pre-checkout ok", validatePreCheckout(pre).ok === true);
  check("pre-checkout rejects wrong amount", validatePreCheckout({ ...pre, total_amount: 1 }).ok === false);
  check("pre-checkout rejects unknown payload", validatePreCheckout({ ...pre, invoice_payload: "nope" }).ok === false);
  const stockBefore = stockLeft("macchiato");
  setStock("macchiato", 1);
  check("pre-checkout rejects when stock ran out", validatePreCheckout(pre).ok === false);
  setStock("macchiato", stockBefore);

  // --- 9. successful payment -> paid order, idempotent ---
  const pay1 = completePayment({ id: V, first_name: "V" }, { ...pre, telegram_payment_charge_id: "chg_1" });
  check("payment creates an order", pay1.ok && !pay1.duplicate);
  if (pay1.ok) {
    const o = getOrder(pay1.order.id)!;
    check("order is Stars-paid with charge id", o.paymentMethod === "stars" && o.paymentStatus === "paid" && o.chargeId === "chg_1");
    check("order total includes delivery fee", o.total === totalEtb && o.deliveryFee === 50 && o.address === "Bole Atlas, near the bank");
    check("stock decremented", stockLeft("macchiato") === stockBefore - 2);
  }
  const pay2 = completePayment({ id: V, first_name: "V" }, { ...pre, telegram_payment_charge_id: "chg_1" });
  check("redelivered payment is a duplicate, no 2nd order", pay2.ok && pay2.duplicate && pay1.ok && pay2.order.id === pay1.order.id);
  check("stock not decremented twice", stockLeft("macchiato") === stockBefore - 2);
  check("paid invoice can't be paid again", validatePreCheckout(pre).ok === false);
  check("unknown draft -> not ok (bot refunds)", completePayment({ id: V, first_name: "V" }, { ...pre, invoice_payload: "nope", telegram_payment_charge_id: "chg_2" }).ok === false);

  // --- 10. widget "Pay now" tap also sends the in-chat invoice ---
  const W = 9003;
  const q = { from: { id: W }, chat: { id: W, type: "private" }, message_id: 7 };
  await handleWidgetQuery({ ...q, id: "w1", data: "add:macchiato:M" });
  const wBefore = sent("sendInvoice").length;
  const co = await handleWidgetQuery({ ...q, id: "w2", data: "checkout" });
  check("widget checkout -> Stars invoice", co.ok && sent("sendInvoice").length === wBefore + 1 && sent("sendInvoice").at(-1)?.body.prices[0].amount === starsFor(110));

  // --- 11. model JSON parsing ---
  const good = parseAgentJson('```json\n{"reply":"ሰላም","actions":[{"type":"show_item","id":"macchiato"},{"type":"hack"},{"type":"add_to_cart","id":"x","qty":99}]}\n```');
  check("parses fenced JSON, drops invalid actions", !!good && good.actions.length === 1 && good.actions[0].type === "show_item");
  check("garbage -> null", parseAgentJson("not json") === null && parseAgentJson('{"reply":""}') === null);

  // --- 12. empty-cart checkout is handled gracefully ---
  const E = 9004;
  const emptyNotes = await runDeliveryActions(E, E, [{ type: "checkout" }], "am");
  check("checkout with empty cart -> friendly message, not an invoice", emptyNotes[0].ok === false && emptyNotes[0].detail === "empty");

  console.log(failures === 0 ? "\nALL AGENT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
