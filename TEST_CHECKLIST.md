# Buna Corner — Phone Test Checklist

Do these on your phone, inside Telegram, after deploying and doing the
BotFather steps in README.md. (Append `?demoOwner=1` to the app URL in a
browser for the owner screens without a real owner ID.)

## Setup
- [ ] Open the bot profile → **Launch** button is visible, opens the shop directly (no `/start` needed).
- [ ] App opens fullscreen, header is dark coffee, no browser chrome / no plain-web feel.
- [ ] Demo banner is NOT shown inside Telegram (it shows only in a browser).

## Customer
- [ ] Home: hero, category chips (Coffee / Tea / Food / Beans), Popular grid, menu list all load (no skeletons stuck).
- [ ] Tap a category chip — list filters.
- [ ] Tap an item (e.g. Ethiopian Macchiato) — photo, description, size/milk/sugar pickers, quantity, price updates.
- [ ] Add to cart — phone vibrates (haptic), toast appears, cart badge increments.
- [ ] Cart: change quantity, remove an item, switch Pickup ↔ Delivery.
- [ ] Delivery: type an address; tap "Share my location" (Telegram asks permission).
- [ ] Tip buttons (0/10/20/50) and notes change the total.
- [ ] MainButton at the bottom shows "Checkout • X ETB" on the cart view; BackButton returns to Home.
- [ ] Checkout: pick Telebirr → mock pay code shown → "I paid" → order placed, haptic success.
- [ ] Checkout: pick Chapa → same mock flow. Pick Stars → Stars mock screen.
- [ ] Tracking: timeline shows Received → Brewing → Ready/Out for delivery; refreshes (polls every 10 s).
- [ ] Loyalty (🎟️ tab): stamp card shows stamps earned (1 per coffee), order history lists the order; tapping it opens tracking.
- [ ] Reorder card on Home re-adds the last order to the cart.
- [ ] Beans tab: subscribe to "Beans of the Month" (900 ETB/mo) — shows active + next billing date.
- [ ] Share invite: "Share my invite link" opens the Telegram share sheet with `t.me/<bot>/shop?startapp=ref_<id>`; opening that link shows the referral banner.

## Owner (as owner ID, or `?demoOwner=1`)
- [ ] Owner tab (🧑‍🍳) is visible; it is NOT visible for a normal customer.
- [ ] New order triggers a bot message to the owner (needs BOT_TOKEN + OWNER_TELEGRAM_ID).
- [ ] Incoming orders list shows the new order; tapping Brewing/Ready sends the customer a bot status message.
- [ ] Daily sales: count + revenue update after the order.
- [ ] Menu management: "Mark sold out" on an item — it shows SOLD OUT on Home and cannot be ordered.
- [ ] "📣 Post" on an item posts it to the channel with an "Order now" button (needs BOT_TOKEN + CHANNEL_ID + bot as channel admin); without a token it shows a clear error, not a crash.

## API smoke test (from a terminal)
```bash
curl $APP_URL/api/health
curl $APP_URL/api/menu | head -c 400
curl -X POST $APP_URL/api/orders -H 'Content-Type: application/json' \
  -d '{"items":[{"id":"macchiato","qty":2,"options":{"Size":"Medium"}}],"fulfillment":"pickup","tip":10,"paymentMethod":"telebirr"}'
curl $APP_URL/api/orders/BC-1001
npm run test:auth
```

## Buna AI — phone tests (no Gemini key needed; mock mode)
- [ ] Floating 💬 button (bottom-right) opens the chat panel; the AI greets you by name in Amharic.
- [ ] Ask in Amharic (e.g. "ማኪያቶ አለ?") — reply is Amharic and names a real menu item + price.
- [ ] Ask in English (e.g. "do you have croissant?") — reply switches to English.
- [ ] Tap EN/አማ in the chat header — replies follow the toggle.
- [ ] Tap 🔊 Listen on an AI reply — in mock mode nothing plays (no key); with a key it speaks.
- [ ] Turn on "Voice replies" — with a key, replies auto-play; in mock mode they don't (expected).
- [ ] Item page: "🔊 Listen to description" shows the spoken-style description text (audio only with a key).
- [ ] Memory: tell the AI your favourite ("I love macchiato"), place an order, then ask "what do I usually order?" — it remembers your favourite / order count.
- [ ] Bot: send `/start` — AI greeting mentions 2 popular items + buttons "☕ Order" and "💬 Ask Buna AI".
- [ ] Bot: send any free text ("what beans do you have?") — AI replies in the bot (same memory as the Mini App).
- [ ] Bot: send `/checkout` after chatting about a favourite — checkout card with "🧾 Checkout & Pay" opens the Mini App at checkout with the item prefilled.
- [ ] API (no key): `GET /api/ai/health` → `aiConfigured: false, mock: true`; `POST /api/ai/chat` returns an Amharic mock reply; `POST /api/ai/describe` returns text with `audioBase64: null`.

## Inventory — phone + API tests
- [ ] Item page: an item at/below its low level shows "⚠️ Only X left today" (e.g. order croissants down or use the owner tab to set qty 3).
- [ ] Item at 0 shows "Sold out today" and cannot be added to the cart.
- [ ] Cart: adding more than the stock left shows "Only X left" and does not add.
- [ ] Owner tab (🧑‍🍳) → 📦 Inventory: stock list with 🟢/🟠/🔴, "+10 restock" and "Set qty" work; low-stock items are highlighted.
- [ ] Daily sales summary (owner) lists low-stock items.
- [ ] API: order 2 macchiatos → `GET /api/menu` shows macchiato stock 40 → 38; order 99 croissants → 400 error "Only 25 Croissants left" (or however many are left).
- [ ] AI stock question: ask "do you have croissant?" after selling them out — the AI says it's sold out and suggests an in-stock alternative.

## HTML widgets (Bot API 10.4) — phone tests (needs BOT_TOKEN + webhook)
- [ ] In the bot chat, send "tell me about macchiato" — AI text reply arrives AND the ☕ item card appears below it (name, 80 ETB, "40 left").
- [ ] Tap size M on the card — the price updates to 110 ETB and M highlights.
- [ ] Tap "➕ Add to cart" — the card updates to "✅ Added (1) — add another".
- [ ] Tap it again — "✅ Added (2)".
- [ ] Tap "🧾 Checkout" — the bot sends a checkout card; "🧾 Checkout & Pay" opens the Mini App at checkout with 2× Medium macchiato prefilled.
- [ ] Place the order — a 🧾 tracker widget appears in the bot chat (Received → Brewing → Ready).
- [ ] Owner marks the order Brewing — the tracker widget updates in place (no new message).
- [ ] Offline check (no token, no network): `npm run test:widgets` — all checks pass, both widgets under 4,096 compressed bytes, no external URLs/images in the HTML.
