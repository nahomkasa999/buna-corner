# What could not be done (and why)

## Real payments — NOT done (mock only)
Telebirr and Chapa are mock screens: a mock pay code is shown and "I paid"
places the order. Real Telebirr/Chapa integration needs a merchant account,
API credentials, and a server-side payment verification webhook — none of
which exist for this fictional demo shop. The checkout is structured so a
real gateway can be swapped in: replace the mock step in `app/page.tsx`
(checkout view) and verify the payment in `POST /api/orders` before
creating the order.

## Telegram Stars payments / Stars subscriptions — NOT done (mock only)
Stars payments need a live bot with a Stars invoice flow (`sendInvoice`
with `XTR` currency) and a `pre_checkout_query` handler. The subscription
endpoint accepts `method: "stars"` and records it, but no invoice is ever
sent. Wire `bot/bot.ts` to `sendInvoice` when a real bot token is configured.

## Persistence — in-memory only
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
