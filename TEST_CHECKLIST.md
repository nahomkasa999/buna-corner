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
