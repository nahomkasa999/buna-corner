# ☕ Buna Corner — Telegram Mini App Storefront (Demo)

A fictional Addis Ababa coffee shop as a native-feeling Telegram Mini App.
Next.js 15 (App Router, TypeScript) + Tailwind, grammY bot, in-memory demo
store with a Prisma/SQLite schema ready for real persistence.

## What it does

- **Customer:** home (hero, categories, popular, reorder last order), item page
  (size/milk/sugar options), cart + checkout (pickup/delivery, address/location,
  tip, notes), mock Telebirr/Chapa payment + Telegram Stars option, live order
  tracking (polls every 10 s), loyalty stamp card (8th coffee free), order
  history, "Beans of the Month" subscription, referral share link.
- **Owner** (Telegram ID in `OWNER_TELEGRAM_ID`, or `?demoOwner=1` in demo):
  incoming orders with status buttons, menu management (sold-out toggle),
  daily sales summary, post-to-channel.
- **Bot:** `/start` (with `ref_` / `item_` deep links), `/shop`, `/orders`;
  owner gets a Telegram message on every new order; customers get a status
  message on every status change (when `BOT_TOKEN` is set).
- **Auth:** `initData` validated on the backend with HMAC-SHA256 per
  [Telegram's docs](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
  (`lib/telegram-auth.ts`). Outside Telegram the app runs in demo mode
  (demo user, banner shown) and never crashes.

## Run locally

```bash
cp .env.example .env.local   # fill BOT_TOKEN etc. (optional for demo)
npm install
npm run dev                  # http://localhost:3000
npm run build                # must pass
npm run seed                 # prints the 15-item seed menu
npm run test:auth            # initData HMAC validation checks
```

## BotFather — manual steps (must be done by the owner)

1. Talk to **@BotFather** → `/newbot` → name it e.g. `Buna Corner`, username
   e.g. `Alerter_nazbot`. Copy the token into `BOT_TOKEN` / `BOT_USERNAME`.
2. `/mybots` → your bot → **Bot Settings → Menu Button** → **Configure Menu
   Button** → set the Web App URL to your deployed URL
   (e.g. `https://buna-corner.vercel.app`). This is the **Main Mini App**:
   the bot profile then shows a **Launch** button.
3. (Optional, same screen) set the menu button text to `☕ Order coffee`.
4. Set the webhook so the bot receives updates:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<APP_URL>/api/bot`
5. Add the bot as admin to your channel and set `CHANNEL_ID`
   (e.g. `@bunacorner` or `-100…`).
6. Get your Telegram user id from **@userinfobot** → `OWNER_TELEGRAM_ID`.
7. Direct link: `https://t.me/Alerter_nazbot/shop`
   Item deep link: `https://t.me/Alerter_nazbot/shop?startapp=item_macchiato`
   Referral link: `https://t.me/Alerter_nazbot/shop?startapp=ref_<your-id>`

## AI barista — Buna AI (Amharic-first, remembers you, talks back)

- **In the Mini App:** floating 💬 button opens a chat panel. Amharic by
  default, EN/አማ toggle, "Voice replies" toggle, and a 🔊 Listen button on
  every AI reply. Item pages have a "🔊 Listen to description" button.
- **In the bot:** `/start` greets you with the AI (by name, Amharic), and
  any free-text message to the bot gets an AI reply. `/checkout` (or saying
  "yes, order it" in chat) builds a draft from what the AI remembers you
  like and sends a checkout card with a "🧾 Checkout & Pay" button that
  opens the Mini App at checkout with the draft prefilled.
- **How it works:** `lib/ai.ts` — Gemini `gemini-3-flash-preview` for chat
  (falls back to `gemini-3.5-flash-lite`), `gemini-2.5-flash-preview-tts`
  (voice "Kore") for speech. The system prompt is the warm Ethiopian
  barista; it knows the full menu + live stock, so it never sells a
  sold-out item and suggests an in-stock alternative instead.
- **Memory:** LangChain-style per-user memory implemented by hand in
  `lib/store.ts` — last 12 turns + prefs (language, favourites, order
  count, last order) per Telegram user id, shared between the Mini App
  and the bot. `learnFromOrder()` updates favourites on every order.
  LangChain swap point: `chatWithMemory()` in `lib/ai.ts` is the single
  seam — replace its Gemini call with a LangChain chain
  (`@langchain/google-genai` + a Postgres-backed chat history) and keep
  the `{reply, lang}` shape; routes, bot and frontend need no change.
  (LangChain is deliberately NOT a hard dependency today — the hand-rolled
  memory is ~40 lines and has zero extra install weight.)
- **No key = mock mode:** canned Amharic replies (stock-aware), no audio,
  no network calls, never a crash. Set `GEMINI_API_KEY` in Vercel env vars
  to go live.
- **Cost:** Gemini Flash is pay-as-you-go and cheap — a few cents per
  thousand short chats; TTS is billed per character. No key, no bill.
- **Inventory:** every menu item has live stock (`lib/inventory.ts` seed:
  drinks 20–50 cups/day, food 15–30 portions, beans 10–12 bags; low
  at 5, beans at 3). Orders decrement stock; over-orders are rejected
  with the amount left ("Only 3 Croissants left"); stock 0 flips the
  item sold out. Owner dashboard → 📦 Inventory tab: restock +10 or set
  quantity. Daily sales summary includes low-stock items. Stock is
  in-memory like the rest of the demo store (resets on redeploy).

## HTML widgets (Bot API 10.4) — interactive cards inside the bot chat

Telegram Bot API 10.4 (Nov 9, 2026) lets the bot send a small HTML widget
inside a message bubble — buttons, sizes, a live order tracker — without
the customer leaving the chat.

- **What happens:** ask the bot about an item ("tell me about macchiato",
  "I like croissant") and the AI answers in text **and** sends the item
  card right after it. The card has size buttons (S/M/L), an "➕ Add to
  cart" button and a "🧾 Checkout" button — all working inside the chat.
  Place an order and a 🧾 tracker widget appears in the chat; when the
  owner moves it to Brewing/Ready, the widget updates **in place**.
- **How it works:** `lib/widget.ts` — one self-contained HTML document per
  card (inline CSS+JS, emoji only, no images, no network — the sandbox
  forbids it). Taps call `TelegramWidget.request(data)` (1–64 bytes);
  the bot gets an `update.widget_query`, answers within 15 s with
  `answerWidgetQuery`, and rewrites the card with `editMessageWidgetData`.
  State (`chat_data` ≤ 1,024 bytes) lives on the bot side in
  `lib/store.ts` (`widgetStates`, `widgetDrafts`); the widget redraws on
  the `chatDataChanged` event. Measured sizes: item card 1,970 bytes raw /
  1,027 compressed; order card 1,281 / 797 — well under the 32,768 /
  4,096 limits (`npm run test:widgets` checks this).
- **grammY gap:** grammY 1.46 does not know `sendWidget` or
  `widget_query`, so `lib/widget.ts` uses raw `fetch()` calls to the Bot
  API, and `app/api/bot/route.ts` intercepts `update.widget_query`
  **before** the grammY dispatcher (grammY would drop the unknown update
  type). When grammY ships widget support, `lib/widget.ts` is the single
  seam to swap.
- **Needs:** a real `BOT_TOKEN` + webhook + a private chat with the bot.
  Without a token every widget call returns `{ok:false}` and the bot
  falls back to text-only replies — nothing crashes. See LIMITATIONS.md.

## Deploy (Vercel)

```bash
vercel deploy   # or push to GitHub and import the repo in Vercel
```

Set env vars in Vercel: `BOT_TOKEN`, `BOT_USERNAME`,
`NEXT_PUBLIC_BOT_USERNAME`, `OWNER_TELEGRAM_ID`, `CHANNEL_ID`,
`GEMINI_API_KEY` (real key for Buna AI; without it the AI runs in mock mode),
`NEXT_PUBLIC_APP_URL` (your `https://…vercel.app` URL). Then repeat
BotFather step 2 with that URL and step 4 for the webhook. No database
is required for the demo (in-memory store); for real persistence see below.

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness + bot/owner config flags |
| `GET /api/menu`, `GET /api/menu/[id]` | Menu (with live `stockLeft` per item) |
| `POST /api/auth` | `{initData}` → validated Telegram user or demo user |
| `POST /api/orders` | Create order (`BC-XXXX`, stamps, owner notify); decrements stock, rejects over-orders, teaches the AI your favourites |
| `GET /api/orders?userId=`, `GET /api/orders/[id]` | Orders |
| `PATCH /api/orders/[id]` | Owner-only status change (also notifies customer) |
| `GET /api/drafts/[id]` | Bot-checkout draft (prefills the Mini App cart) |
| `GET /api/inventory` | Owner-only live stock list |
| `PATCH /api/admin/inventory` | Owner-only restock / set quantity |
| `POST /api/ai/chat` | Buna AI chat `{message?, greet?, lang?, voice?}` → `{reply, lang, audioBase64?}` (mock without a key) |
| `POST /api/ai/describe` | Spoken-style item description + TTS audio |
| `POST /api/ai/speak` | TTS for any text |
| `GET /api/ai/health` | `{aiConfigured, ttsConfigured, mock}` |
| `GET /api/loyalty?userId=` | Stamps + history |
| `GET/POST /api/subscription` | Beans of the Month (mock / Stars) |
| `GET /api/admin/sales?date=` | Owner-only daily summary |
| `POST /api/admin/menu` | Owner-only add/edit/hide/toggle |
| `POST /api/channel/post` | Owner-only: post item to channel with Order-now button |
| `POST /api/bot` | grammY webhook (503 if `BOT_TOKEN` missing) |

Demo mode: requests without valid `initData` are served as demo user
`999999` (or `x-demo-user: <id>`); owner routes also accept
`x-demo-owner: 1` / `?demoOwner=1`.

## Real persistence (optional)

`prisma/schema.prisma` has SQLite models (MenuItem, User, Order, OrderLine,
Subscription) mirroring `lib/store.ts`. To switch:

```bash
npx prisma generate && npx prisma db push && npx tsx prisma/seed.ts
```

Then point the API routes at Prisma instead of `lib/store.ts`. The build
deliberately does **not** depend on Prisma generation, so Vercel deploys
work with zero DB setup.

## Test checklist

See [TEST_CHECKLIST.md](TEST_CHECKLIST.md). Known limits:
see [LIMITATIONS.md](LIMITATIONS.md).
