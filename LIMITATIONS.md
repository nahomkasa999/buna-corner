# What could not be done (and why)

## Payments

**In the bot chat: real Telegram Stars (XTR) payments — implemented.**
`lib/checkout.ts` sends a native `sendInvoice`, answers `pre_checkout_query`
and creates the order on `successful_payment` (idempotent on the charge id;
automatic `refundStarPayment` if the order can't be found). What is NOT done:
- **Not tested against live Telegram.** Everything is covered by offline
  tests that record the Bot API calls (`npm run test:agent`, `test:bot`);
  nobody can confirm a real Stars payment without a live bot token. Do a
  1-Star test purchase before going live.
- **ETB → Stars is a fixed rate** (`ETB_PER_STAR`, default 2.5) — not a live
  exchange rate. Check it against what a Star actually pays out to you.
- **Stars are not ETB.** The shop receives Stars and withdraws them via
  Telegram/Fragment; there is no Telebirr/Chapa money flow in the chat.
- **No customer-facing refunds/cancellation flow.** `Order.chargeId` is stored
  so the owner (or a future `/refund`) can call `refundStarPayment`.
- **Stars subscriptions (Beans of the Month) are still mock** — the Mini App
  subscription endpoint records `method: "stars"` but no recurring invoice
  is sent.

**In the Mini App (the "see more" page): Telebirr and Chapa are mock screens**
— a mock pay code is shown and "I paid" places the order. Real
Telebirr/Chapa needs a merchant account, API credentials and a server-side
verification webhook; none exist for this fictional demo shop.

## Persistence — in-memory only (a real-money risk now)
**Before taking real Stars, move the store to a database.** Invoices point at
an in-memory draft; on Vercel a different serverless instance (or a redeploy)
may not have it, so `pre_checkout_query` would refuse a valid invoice
("this order expired — ask me to send a new one"). Nothing is charged in that
case, but the customer has to start the order again. Same for the cart, name
and chat memory.
Orders, loyalty, subscriptions and menu edits live in `lib/store.ts`
(process memory). They reset on every redeploy/restart and do not sync
across Vercel serverless instances. This is deliberate for a zero-setup
demo deploy. `prisma/schema.prisma` + `prisma/seed.ts` provide the real
SQLite/Postgres models to swap in (see README).

## Bot / Main Mini App / channel — needs the owner
The bot token, Main Mini App (Launch button), webhook, owner ID and channel
ID can only be created by the shop owner in BotFather/Telegram. The code
handles all of them gracefully when missing (503 on `/api/bot`, clear
`{ok:false, reason}` on channel post, demo mode in the app), but nothing
can be verified end-to-end in Telegram until those values exist.

## Order-status push notifications
Status-change messages are sent via the bot only when `BOT_TOKEN` is set
and the customer has started the bot (Telegram forbids messaging users who
never started it). The in-app tracking view polls instead, so it works
even without the bot.

## Location
"Share my location" uses `Telegram.WebApp.requestLocation` when available;
in a browser it falls back to a typed address. No map is rendered.

## Images
Photos are Unsplash placeholders, not the shop's real photos.

## Buna AI — limits
- **The AI lives in the bot only.** The Mini App no longer has an AI chat
  panel; the old `/api/ai/*` routes still exist but nothing in the shop UI
  calls them.
- **No Gemini key = mock mode.** A rule-based salesperson (still does item
  cards, cart, delivery, pay, name-after-3-turns, in Amharic/English) — it is
  much less flexible than the live model.
- **The LangGraph loop is tested with a scripted fake model, not real
  Gemini** (no key in dev). Tool execution, size changes, sold-out refusals,
  voice gating and fallback-to-mock are all covered offline. Two things still
  need a live try: whether Gemini picks the right tools at the right moment,
  and how natural its casual Amharic sounds.
- **Voice notes:** Amharic TTS quality is whatever Gemini's TTS offers (it may
  sound less natural than English). Voice is sent as MP3 through `sendVoice`,
  which Telegram documents as accepted. If it ever shows as a file instead of
  a voice bubble, switch the encoder to OGG/Opus. Voice transcription of
  customers' notes depends on Gemini understanding Amharic speech. Each voice
  reply adds a few seconds (TTS + encoding).
- **HTML widgets are unverified in production.** If a product card or cart
  card doesn't appear, send `/widgettest` to the bot: it replies with
  Telegram's exact error, and every failed Telegram call is logged in Vercel
  (`[telegram] sendWidget failed: …`). The product photo is sent first either
  way, so the customer always sees the product.
- **Set `GEMINI_API_KEY`** in Vercel env vars for the live model. The key is
  never in the repo (`.env.example` carries only the `TEST_KEY_1`
  placeholder).
- **Memory is in-memory** (per-user history + favourites in `lib/store.ts`).
  It resets on every redeploy/restart and does not sync across Vercel
  serverless instances. The shape is Prisma-ready — persist it the same
  way as orders when real persistence is added.
- **TTS Amharic quality depends on Gemini** — Amharic voice support is
  whatever `gemini-2.5-flash-preview-tts` offers; it may sound less
  natural than English. If TTS fails, chat still works (audio is null).
- **Voice autoplay needs a tap** on iOS/Telegram: the first play must
  follow a user gesture; "Voice replies" auto-play only works after the
  user has interacted with the chat.
- **The AI can still be wrong** about the menu if the live model
  hallucinates — the system prompt + live stock context make it rare,
  and it never invents prices in mock mode.

## HTML widgets (Bot API 10.4) — limits
- **Needs a real bot token + webhook + private chat.** Without
  `BOT_TOKEN` the bot falls back to text-only replies; widgets are never
  sent and nothing crashes. In production widgets work only in the
  one-to-one chat with the bot — groups, channels, inline mode and
  forwarding are test-server only, and sent widgets are protected
  content (cannot be forwarded or copied).
- **Tiny by design.** One HTML document, inline CSS+JS only, no network
  (`fetch`/WebSocket throw), no external images/assets — emoji only.
  Limits: 32,768 bytes raw, 4,096 bytes after zlib level-9 compression,
  `chat_data` ≤ 1,024 bytes, request data 1–64 bytes, answer ≤ 1,024
  bytes within 15 seconds, 5 taps per 5 seconds per user. Both Buna
  widgets are ~1–2 KB raw / ~0.8–1 KB compressed.
- **grammY doesn't know widgets yet** (1.46), so `lib/widget.ts` uses raw
  Bot API calls and the webhook route intercepts `widget_query` before
  grammY. If grammY adds widget support, swap that one module.
- **Widget state is in-memory** (`widgetStates`, `widgetDrafts` in
  `lib/store.ts`): a redeploy forgets which widget message had which
  draft — tapping an old card after a redeploy starts a fresh draft.
  The widget HTML itself never changes after sending; only `chat_data`
  can be edited.
- **Older Telegram apps** without widget support show the message as
  unsupported media with its caption — every widget is sent with a
  caption naming the item/order for that reason.

## Inventory — limits
- **Stock is in-memory** (same as orders/loyalty): it resets on every
  redeploy/restart and does not sync across Vercel serverless instances.
  Restock in the owner tab after a redeploy, or move it to Prisma with
  the rest of the store.
- **No low-stock Telegram warnings are sent.** Low stock is visible only
  in the owner dashboard (📦 Inventory tab) and in the daily sales
  summary response — nobody is messaged about it. This is deliberate:
  everyone interacting is treated as a customer.
- **Daily counts:** stock is seeded per day (cups/portions/bags), not
  per real delivery — there is no supplier/reorder flow in this demo.
