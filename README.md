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

## Deploy (Vercel)

```bash
vercel deploy   # or push to GitHub and import the repo in Vercel
```

Set env vars in Vercel: `BOT_TOKEN`, `BOT_USERNAME`,
`NEXT_PUBLIC_BOT_USERNAME`, `OWNER_TELEGRAM_ID`, `CHANNEL_ID`,
`NEXT_PUBLIC_APP_URL` (your `https://…vercel.app` URL). Then repeat
BotFather step 2 with that URL and step 4 for the webhook. No database
is required for the demo (in-memory store); for real persistence see below.

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness + bot/owner config flags |
| `GET /api/menu`, `GET /api/menu/[id]` | Menu |
| `POST /api/auth` | `{initData}` → validated Telegram user or demo user |
| `POST /api/orders` | Create order (`BC-XXXX`, stamps, owner notify) |
| `GET /api/orders?userId=`, `GET /api/orders/[id]` | Orders |
| `PATCH /api/orders/[id]` | Owner-only status change (also notifies customer) |
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
