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
   Leave `allowed_updates` unset (default). If you ever set it, it must
   include `message`, `pre_checkout_query` (Stars payments) and
   `widget_query` (HTML widget taps).
5. Add the bot as admin to your channel and set `CHANNEL_ID`
   (e.g. `@bunacorner` or `-100…`).
6. Get your Telegram user id from **@userinfobot** → `OWNER_TELEGRAM_ID`.
7. Direct link: `https://t.me/Alerter_nazbot/shop`
   Item deep link: `https://t.me/Alerter_nazbot/shop?startapp=item_macchiato`
   Referral link: `https://t.me/Alerter_nazbot/shop?startapp=ref_<your-id>`

## The bot is the shop — Buna AI as a salesperson, all inside Telegram

Customers never have to open a web page to buy. The bot **is** the shop
assistant: it talks like a person, sells, and takes payment right in the chat.

**A typical chat**

1. `/start` → the bot just says *"ሰላም! እንኳን ወደ ቡና ኮርነር በደህና መጡ ☕"*.
   No buttons, no menu, no name yet.
2. The customer talks (Amharic or English — it follows them). The AI
   recommends, answers, upsells gently. It never dumps a menu or says "tap".
3. **After ~3 messages** it asks their name once, naturally, then uses it.
4. Customer asks about a **specific product** → the AI answers in a sentence
   *and* sends that product's interactive **HTML widget** (Bot API 10.4):
   size buttons, "➕ Add to cart", "💳 Pay now" — all inside the bubble.
5. Customer says what they want → the AI puts it in their cart (stock,
   sizes and quantities are validated server-side; sold-out items are
   refused). Pickup is free, delivery is +50 ETB and the AI asks for the
   address in chat.
6. Customer is done / says "pay" → a native **Telegram Stars invoice** (XTR)
   appears **in the chat** and they pay there. On `successful_payment` the
   order is created, stock drops, the owner is notified, the customer gets a
   thank-you and a live **order-tracker widget** that updates in place as
   the owner moves the order to Brewing/Ready.
7. **Only if they ask to see more** (full menu, photos, all the details) the
   bot sends one "☕ Full menu" button that opens the Mini App. That is the
   only time a web page is offered.

Commands exist but are never pushed on the customer: `/orders` (text
status), `/checkout` (invoice for the current cart), `/shop` (Mini App link),
`/stock` (owner only).

**Payments — Telegram Stars.** Menu prices are in ETB; the invoice converts
at `ETB_PER_STAR` (default 2.5, rounded up). Stars need no provider token.
Flow: `sendInvoice` (one price line, the order itemised in the description)
→ `pre_checkout_query` (stock, amount, not-already-paid; answered instantly)
→ `successful_payment` (order created, idempotent on the charge id; if the
order can't be found the Stars are refunded automatically with
`refundStarPayment`). The invoice is an immutable snapshot of the cart, so
adding items afterwards can't change what was paid for. Code: `lib/checkout.ts`.

**How the AI works.** `lib/agent.ts` — Gemini (`gemini-3-flash-preview`,
fallback `gemini-3.5-flash-lite`) answers with JSON `{reply, actions}`;
actions are `show_item`, `add_to_cart`, `remove_from_cart`, `set_delivery`,
`checkout`, `show_more`. The model proposes, the server validates and
executes. The system prompt carries the menu with ids, live stock, the
customer's name/favourites and their current cart. It is honest that it is
the shop's AI if asked.

- **No key = mock salesperson.** Without `GEMINI_API_KEY` (or if Gemini
  errors) a rule-based Amharic/English salesperson runs the same flow
  (item cards, cart, delivery, pay, name after 3 turns), so the bot never
  goes quiet.
- **Memory:** last 12 turns + prefs (language, favourites, order count) +
  the name they told us, per Telegram user id — `lib/store.ts`
  (in-memory; Prisma-ready shape). `chatWithMemory()` in `lib/ai.ts` remains
  the seam used by the `/api/ai/*` routes.
- **Cost:** Gemini Flash is a few cents per thousand short chats.

**Mini App.** Still there as the "see more" destination (full menu with
photos, loyalty stamps, owner dashboard). The AI chat panel was removed from
it — the AI lives in the bot.

## HTML widgets (Bot API 10.4) — interactive cards inside the bot chat

Telegram Bot API 10.4 (Nov 9, 2026) lets the bot send a small HTML widget
inside a message bubble — buttons, sizes, a live order tracker — without
the customer leaving the chat.

- **What happens:** ask the bot about an item ("tell me about macchiato",
  "I like croissant") and the AI answers in text **and** sends the item
  card right after it. The card has size buttons (S/M/L), an "➕ Add to
  cart" button and a "💳 Pay now" button (sends the Stars invoice) — all
  working inside the chat.
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
`ETB_PER_STAR` (Stars conversion, default 2.5),
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
| `GET /api/drafts/[id]` | Draft/cart (prefills the Mini App cart) |
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
| `POST /api/bot` | grammY webhook: chat, Stars `pre_checkout_query` / `successful_payment`, widget queries (503 if `BOT_TOKEN` missing) |

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
