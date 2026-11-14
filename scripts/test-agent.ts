// Offline checks for the in-chat salesperson (LangGraph agent + mock), cart
// card, voice encoding and Stars payment — no key, no real token, no network
// (fetch to api.telegram.org is stubbed; the "live" model is scripted).
// Run: npx tsx scripts/test-agent.ts   Exits non-zero on any failure.
process.env.BOT_TOKEN = "test-token";
process.env.TG_QUIET = "1";
delete process.env.GEMINI_API_KEY; // mock salesperson unless a model is injected
delete process.env.ETB_PER_STAR;
delete process.env.NEXT_PUBLIC_APP_URL;

const calls: { method: string; body: Record<string, any> }[] = [];
globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = String(url).split("/").pop() as string;
  calls.push({ method, body: typeof init?.body === "string" ? JSON.parse(init.body) : {} });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 1000 + calls.length } }), { status: 200 });
}) as typeof fetch;
const sent = (m: string) => calls.filter((c) => c.method === m);

import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { extractName, pickLang, runDeliveryActions, salesTurn, startGreeting } from "../lib/agent";
import { completePayment, sendCartInvoice, starsFor, validatePreCheckout } from "../lib/checkout";
import { buildCartWidget, cartWidgetState, handleWidgetQuery, widgetSizes } from "../lib/widget";
import { pcmToMp3, rateFromMime } from "../lib/voice";
import { getCart, getCartWidget, getDraft, getOrCreateUserMemory, getOrder, setStock, stockLeft } from "../lib/store";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** A fake chat model that plays back scripted turns (tool calls / text) and records what it saw. */
class Scripted extends BaseChatModel {
  seen: BaseMessage[][] = [];
  constructor(private script: (AIMessage | Error)[]) { super({}); }
  _llmType() { return "scripted"; }
  bindTools() { return this as never; }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const m = this.script.shift();
    if (!m) throw new Error("script exhausted");
    if (m instanceof Error) throw m;
    return { generations: [{ message: m, text: typeof m.content === "string" ? m.content : "" }] };
  }
}
let cid = 0;
const callTools = (...c: [string, Record<string, unknown>][]) =>
  new AIMessage({ content: "", tool_calls: c.map(([name, args]) => ({ name, args, id: `c${++cid}`, type: "tool_call" as const })) });
const say = (text: string) => new AIMessage(text);
const toolResults = (m: Scripted) => m.seen.flat().filter((x) => x.getType() === "tool").map((x) => String(x.content));

async function main(): Promise<void> {
  // ===== 1. /start: just selam, casual, no name =====
  const U = 9001;
  const greet = startGreeting(U, "Telegram-Nahom");
  check("/start greets with selam", greet.startsWith("ሰላም"));
  check("/start is casual (no formal 'በደህና መጡ')", !greet.includes("በደህና መጡ"));
  check("/start does not use the Telegram first name", !greet.includes("Nahom"));

  // ===== 2. name asked after a few turns, once (mock) =====
  const t1 = await salesTurn(U, "Telegram-Nahom", "selam");
  const t2 = await salesTurn(U, "Telegram-Nahom", "what is a macchiato?");
  check("no name question on turns 1-2", !t1.askedName && !t2.askedName);
  check("asking about a product shows it", t2.deliver.some((a) => a.type === "show_item" && a.id === "macchiato"));
  const t3 = await salesTurn(U, "Telegram-Nahom", "sounds good, tell me more about croissant");
  check("'more about croissant' shows croissant, not the full menu",
    t3.deliver.some((a) => a.type === "show_item" && a.id === "croissant") && !t3.deliver.some((a) => a.type === "show_more"));
  check("name asked on turn 3", t3.askedName && /ስም ማን|your name/.test(t3.reply));
  const t4 = await salesTurn(U, "Telegram-Nahom", "Abebe");
  check("bare name saved", t4.savedName === "Abebe" && getOrCreateUserMemory(U).callName === "Abebe");
  const t5 = await salesTurn(U, "Telegram-Nahom", "hello again");
  check("never asks the name twice", !t5.askedName && !/ስም ማን|your name/.test(t5.reply));
  check("returning /start uses the saved name", startGreeting(U, "x").includes("Abebe"));

  // ===== 3. casual Amharic in the mock =====
  const A = 9010;
  const am1 = await salesTurn(A, "A", "ሰላም");
  const am2 = await salesTurn(A, "A", "ማኪያቶ እፈልጋለሁ");
  const formal = /ልጠጣልዎት|ይፈልጋሉ|በደህና መጡ|ልላክልዎት|ይጻፉልኝ|ስምዎ/;
  check("Amharic replies avoid formal -ዎት forms", !formal.test(am1.reply + am2.reply), am1.reply + " | " + am2.reply);

  // ===== 4. name extraction + language =====
  check("'I'm Abebe' -> Abebe", extractName("I'm Abebe")?.name === "Abebe");
  check("'ስሜ አበበ ነው' -> አበበ", extractName("ስሜ አበበ ነው")?.name === "አበበ");
  check("'macchiato' / 'Medium' / 'I'm hungry' / 'yes' are not names",
    extractName("macchiato") === null && extractName("Medium") === null && extractName("I'm hungry") === null && extractName("yes") === null);
  check("Ethiopic -> am; English -> en; 'ok' keeps", pickLang("ሰላም", "en") === "am" && pickLang("I want a coffee please", "am") === "en" && pickLang("ok", "am") === "am");

  // ===== 5. the screenshot bugs (mock) =====
  const S = 9020;
  await salesTurn(S, "S", "I want the macchiato");
  const med = await salesTurn(S, "S", "Medium");
  const sc = getCart(S)!;
  check("'Medium' changes the size — no second macchiato", sc.lines.length === 1 && sc.lines[0].qty === 1 && sc.lines[0].options?.Size === "Medium" && sc.lines[0].unitPrice === 110, JSON.stringify(sc.lines));
  check("cart change -> cart card delivered", med.deliver.some((a) => a.type === "cart"));
  const where = await salesTurn(S, "S", "Where is the thing i want to see it");
  check("'where is it, I want to see it' -> shows the last product", where.deliver.some((a) => a.type === "show_item" && a.id === "macchiato"));
  const notes = await runDeliveryActions(S, S, where.deliver, "en");
  check("show_item sends a PHOTO then the WIDGET", sent("sendPhoto").length >= 1 && sent("sendWidget").length >= 1 && notes[0].ok);
  const seeDirect = await salesTurn(S, "S", "Let me see the croissant");
  check("'let me see the croissant' -> croissant card", seeDirect.deliver.some((a) => a.type === "show_item" && a.id === "croissant"));

  // ===== 6. LangGraph agent with a scripted "live" model =====
  const L = 9030;
  // a) the model only TALKS about the product; the server still shows it because they asked to see it
  let m = new Scripted([say("Our macchiato is a local favourite — rich espresso and a cloud of milk.")]);
  let r = await salesTurn(L, "L", "Let me see the macchiato", { model: m });
  check("graph: plain reply used, not mock", !r.mock && r.reply.startsWith("Our macchiato"));
  check("graph: 'let me see' guarantees the card even if the model forgot", r.deliver.some((a) => a.type === "show_item" && a.id === "macchiato"));
  check("graph: system prompt demands simple Amharic", m.seen[0][0].getType() === "system" && /SIMPLE, everyday Addis chat/.test(String(m.seen[0][0].content)));

  // b) add, then change size: update_cart_item, one line, and the model sees the real result
  m = new Scripted([callTools(["add_to_cart", { id: "macchiato", size: "S" }]), say("Added a small macchiato! Bigger size?")]);
  r = await salesTurn(L, "L", "I'll have the macchiato", { model: m });
  check("graph: add_to_cart tool ran", getCart(L)?.lines.length === 1 && r.cartChanged && r.deliver.some((a) => a.type === "cart"));
  check("graph: model saw 'OK: added …' from the tool", toolResults(m).some((t) => t.startsWith("OK: added")));
  m = new Scripted([callTools(["update_cart_item", { id: "macchiato", size: "M" }]), say("Medium it is!")]);
  await salesTurn(L, "L", "Medium", { model: m });
  const lc = getCart(L)!;
  check("graph: update_cart_item changes size in place (1 line, Medium, 110)", lc.lines.length === 1 && lc.lines[0].options?.Size === "Medium" && lc.lines[0].unitPrice === 110);

  // c) sold out: the tool says FAILED and the model hears it
  setStock("croissant", 0);
  m = new Scripted([callTools(["add_to_cart", { id: "croissant" }]), say("Ah, croissants are gone today — try the sambusa?")]);
  await salesTurn(L, "L", "add a croissant", { model: m });
  check("graph: sold-out add refused by the server", !getCart(L)?.lines.some((l) => l.id === "croissant"));
  check("graph: model was told FAILED", toolResults(m).some((t) => t.startsWith("FAILED")));
  setStock("croissant", 25);

  // d) several tools in one step + checkout
  m = new Scripted([callTools(["set_delivery", { fulfillment: "pickup" }], ["checkout", {}]), say("Here's your payment 💳")]);
  r = await salesTurn(L, "L", "that's all", { model: m });
  check("graph: checkout queued (and no extra cart card before the invoice)", r.deliver.some((a) => a.type === "checkout") && !r.deliver.some((a) => a.type === "cart"));
  check("graph: invoice comes last", r.deliver[r.deliver.length - 1].type === "checkout");

  // e) speak -> voice note (but not on every message)
  const V2 = 9031;
  m = new Scripted([callTools(["speak", {}]), say("ማኪያቶአችን በጣም ጣፋጭ ነው ☕")]);
  r = await salesTurn(V2, "V", "ሰላም", { model: m });
  check("graph: speak -> voice reply", r.voice === true);
  m = new Scripted([callTools(["speak", {}]), say("እሺ!")]);
  r = await salesTurn(V2, "V", "እሺ", { model: m });
  check("graph: voice stays occasional (not twice in a row)", r.voice === false);
  r = await salesTurn(V2, "V", "ሌላስ?", { model: new Scripted([say("ክሮሳንም አለ")]), viaVoice: true });
  check("customer sent voice -> answer by voice", r.voice === true);

  // f) the model errors -> mock takes over, the bot doesn't go silent
  r = await salesTurn(V2, "V", "do you have croissant?", { model: new Scripted([new Error("503 overloaded")]) });
  check("graph: model failure falls back to the mock", r.mock === true && r.reply.length > 0 && r.deliver.some((a) => a.type === "show_item"));

  // ===== 7. cart card widget =====
  const cw = widgetSizes(buildCartWidget());
  check("cart widget within limits", cw.raw <= 32768 && cw.compressed <= 4096, `${cw.raw}/${cw.compressed}`);
  check("cart widget: no innerHTML / network / external URLs", !/innerHTML|fetch\s*\(|https?:\/\//.test(buildCartWidget()));
  check("cart state under 1,024 bytes", JSON.stringify(cartWidgetState(S)).length <= 1024);
  calls.length = 0;
  await runDeliveryActions(S, S, [{ type: "cart" }], "en");
  const card = getCartWidget(S);
  check("cart card sent and remembered", sent("sendWidget").length === 1 && !!card);
  await runDeliveryActions(S, S, [{ type: "cart" }], "en");
  check("re-sending deletes the old card (no clutter)", sent("deleteMessage").length === 1);
  const q = { from: { id: S }, chat: { id: S, type: "private" }, message_id: getCartWidget(S)!.messageId };
  const before = getCart(S)!.lines[0].qty;
  await handleWidgetQuery({ ...q, id: "c1", data: "ci:0" });
  check("cart card '+' adds one", getCart(S)!.lines[0].qty === before + 1);
  await handleWidgetQuery({ ...q, id: "c2", data: "cd:0" });
  check("cart card '−' removes one", getCart(S)!.lines[0].qty === before);
  check("cart card edits in place", sent("editMessageWidgetData").length >= 2);

  // ===== 8. voice encoding =====
  check("rate parsed from Gemini mime", rateFromMime("audio/L16;codec=pcm;rate=24000") === 24000 && rateFromMime(null) === 24000);
  const pcm = Buffer.alloc(24000 * 2);
  for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / 24000)), i * 2);
  const mp3 = await pcmToMp3(pcm, "audio/L16;codec=pcm;rate=24000");
  check("PCM -> MP3 (frame sync 0xFFE)", mp3.length > 1000 && mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0, `${mp3.length} bytes`);
  const wav = Buffer.concat([Buffer.alloc(44), pcm]);
  wav.write("RIFF", 0, "ascii"); wav.writeUInt32LE(24000, 24);
  check("WAV input handled too", (await pcmToMp3(wav)).length > 1000);

  // ===== 9. delivery + Stars payment (mock) =====
  const P = 9002;
  await salesTurn(P, "P", "I want 2 large macchiato");
  check("add intent -> 2× Large at 140", getCart(P)?.lines[0].qty === 2 && getCart(P)?.lines[0].unitPrice === 140);
  await salesTurn(P, "P", "please deliver it");
  const blocked = await sendCartInvoice(P, P);
  check("invoice blocked until address given", !blocked.ok && blocked.reason === "need_address");
  await salesTurn(P, "P", "Bole Atlas, near the bank");
  check("address captured", getCart(P)?.address === "Bole Atlas, near the bank");
  const pay = await salesTurn(P, "P", "that's all, I'll pay");
  const pn = await runDeliveryActions(P, P, pay.deliver, "en");
  const inv = sent("sendInvoice").at(-1)!;
  check("Stars invoice sent", pn.some((n) => n.action === "checkout" && n.ok) && inv.body.currency === "XTR" && inv.body.prices.length === 1);
  check("amount = ceil(330/2.5) = 132 Stars", inv.body.prices[0].amount === 132 && starsFor(330) === 132);
  const pre = { currency: "XTR", total_amount: 132, invoice_payload: inv.body.payload };
  check("pre-checkout ok / rejects wrong amount / unknown", validatePreCheckout(pre).ok && !validatePreCheckout({ ...pre, total_amount: 1 }).ok && !validatePreCheckout({ ...pre, invoice_payload: "x" }).ok);
  const sb = stockLeft("macchiato");
  const p1 = completePayment({ id: P, first_name: "P" }, { ...pre, telegram_payment_charge_id: "chg_1" });
  const p2 = completePayment({ id: P, first_name: "P" }, { ...pre, telegram_payment_charge_id: "chg_1" });
  check("paid order: Stars, charge id, delivery fee", p1.ok && getOrder(p1.order.id)!.chargeId === "chg_1" && getOrder(p1.order.id)!.total === 330);
  check("idempotent: duplicate, stock decremented once", p2.ok && p2.duplicate && stockLeft("macchiato") === sb - 2);
  check("snapshot draft kept for audit", !!getDraft(inv.body.payload)?.paidChargeId);

  console.log(failures === 0 ? "\nALL AGENT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
