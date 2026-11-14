import { MENU_ITEMS, type MenuItem } from "./data";
import { SEED_STOCK } from "./inventory";
import type { TelegramUser } from "./telegram-auth";

export type OrderStatus = "Received" | "Brewing" | "Ready" | "Out for delivery" | "Completed" | "Cancelled";
export type Fulfillment = "pickup" | "delivery";
export type PaymentMethod = "telebirr" | "chapa" | "stars";

export interface OrderLine {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  options?: Record<string, string>;
  image?: string;
}

export interface Order {
  id: string;
  userId: number;
  userName: string;
  lines: OrderLine[];
  subtotal: number;
  tip: number;
  deliveryFee: number;
  total: number;
  fulfillment: Fulfillment;
  address?: string;
  notes?: string;
  paymentMethod: PaymentMethod;
  paymentStatus: "pending" | "paid" | "mock_paid";
  status: OrderStatus;
  referralCode?: string;
  stampsEarned: number;
  freeDrinkUsed?: boolean;
  /** Order-tracker widget sent to the customer (Bot API 10.4) — set when sent. */
  trackerWidget?: { chatId: number; messageId: number };
  /** Telegram Stars payment charge id (needed for refunds). */
  chargeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyState { stamps: number; freeDrinksEarned: number; totalOrders: number; }
export interface Subscription { userId: number; planId: string; active: boolean; startedAt: string; nextBillingAt: string; method: "stars" | "mock"; }

// --- Inventory ---
export interface StockLevel { qty: number; unit: string; lowAt: number; }
export function isLowStock(s: StockLevel): boolean { return s.qty > 0 && s.qty <= s.lowAt; }

// --- AI barista memory (LangChain-style per-user memory, implemented by hand) ---
// Shape is Prisma-ready: one row per user with a JSON history + prefs.
// In-memory for the demo — resets on redeploy, same as the rest of this store.
export interface ChatTurn { role: "user" | "ai"; text: string; at: string; }
export type NameState = "unknown" | "asked" | "known" | "declined";
export interface UserMemory {
  userId: number;
  name: string; // Telegram first name (for the API); NOT used to greet in the bot
  /** The name the customer told us in chat — the bot asks for it after a few turns. */
  callName?: string;
  nameState: NameState;
  /** Number of customer messages so far (drives "ask their name after a few turns"). */
  userTurns: number;
  history: ChatTurn[]; // last 12 turns, oldest first
  prefs: { lang: "am" | "en"; favourites: string[]; orderCount: number; lastOrderId?: string };
  updatedAt: string;
}
export const MAX_MEMORY_TURNS = 12;

// --- Bot checkout drafts (created from bot chat, completed in the Mini App) ---
export interface DraftOrder {
  id: string;
  userId: number;
  lines: OrderLine[];
  fulfillment: Fulfillment;
  address?: string;
  /** Set on an invoice snapshot: Stars amount the customer was asked to pay. */
  invoiceStars?: number;
  /** Set once paid: Telegram charge id + resulting order (idempotency). */
  paidChargeId?: string;
  orderId?: string;
  createdAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __bunaStore: {
    menu: MenuItem[];
    orders: Order[];
    loyalty: Record<string, LoyaltyState>;
    subs: Record<string, Subscription>;
    referrals: Record<string, string[]>; // referrerId -> referred user ids
    orderSeq: number;
    inventory: Record<string, StockLevel>;
    memories: Record<string, UserMemory>;
    drafts: Record<string, DraftOrder>;
    draftSeq: number;
    /** Widget chat_data per message, keyed `${chatId}:${messageId}` (Bot API 10.4). */
    widgetStates: Record<string, string>;
    /** Current widget-draft id per user (built by tapping "Add to cart" in a widget). */
    widgetDrafts: Record<string, string>;
  } | undefined;
}

function getStore() {
  if (!globalThis.__bunaStore) {
    const inventory: Record<string, StockLevel> = {};
    for (const [id, seed] of Object.entries(SEED_STOCK)) inventory[id] = { ...seed };
    globalThis.__bunaStore = {
      menu: MENU_ITEMS.map((m) => ({ ...m, options: m.options?.map((o) => ({ ...o, choices: [...o.choices] })) })),
      orders: [],
      loyalty: {},
      subs: {},
      referrals: {},
      orderSeq: 1000,
      inventory,
      memories: {},
      drafts: {},
      draftSeq: 0,
      widgetStates: {},
      widgetDrafts: {},
    };
  }
  return globalThis.__bunaStore;
}

export function getMenu(includeHidden = false): MenuItem[] {
  const s = getStore();
  return includeHidden ? s.menu : s.menu.filter((m) => !m.hidden);
}

export function getMenuItem(id: string): MenuItem | undefined {
  return getStore().menu.find((m) => m.id === id || m.slug === id);
}

export function upsertMenuItem(item: Partial<MenuItem> & { id?: string }): MenuItem {
  const s = getStore();
  if (item.id) {
    const idx = s.menu.findIndex((m) => m.id === item.id);
    if (idx >= 0) {
      s.menu[idx] = { ...s.menu[idx], ...item } as MenuItem;
      return s.menu[idx];
    }
  }
  const fresh: MenuItem = {
    id: item.id || `item-${Date.now()}`,
    slug: item.slug || (item.name || "item").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    name: item.name || "New item",
    amharicName: item.amharicName || "",
    description: item.description || "",
    price: item.price ?? 0,
    category: item.category || "Coffee",
    image: item.image || "https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=800&auto=format&fit=crop",
    popular: item.popular, soldOut: item.soldOut, hidden: item.hidden,
    options: item.options,
  };
  s.menu.push(fresh);
  return fresh;
}

export function createOrder(input: {
  user: TelegramUser;
  lines: OrderLine[];
  fulfillment: Fulfillment;
  address?: string;
  notes?: string;
  tip?: number;
  paymentMethod: PaymentMethod;
  referralCode?: string;
}): Order {
  const s = getStore();
  const subtotal = input.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const tip = input.tip ?? 0;
  const deliveryFee = input.fulfillment === "delivery" ? 50 : 0;
  const id = `BC-${++s.orderSeq}`;
  const now = new Date().toISOString();
  // 1 stamp per coffee-category line unit; free drink every 8th stamp
  const coffeeQty = input.lines.reduce((n, l) => {
    const item = s.menu.find((m) => m.id === l.id);
    return n + (item?.category === "Coffee" ? l.qty : 0);
  }, 0);
  const order: Order = {
    id, userId: input.user.id, userName: input.user.first_name,
    lines: input.lines, subtotal, tip, deliveryFee, total: subtotal + tip + deliveryFee,
    fulfillment: input.fulfillment, address: input.address, notes: input.notes,
    paymentMethod: input.paymentMethod, paymentStatus: input.paymentMethod === "stars" ? "paid" : "mock_paid",
    status: "Received", referralCode: input.referralCode, stampsEarned: coffeeQty,
    createdAt: now, updatedAt: now,
  };
  s.orders.unshift(order);
  const key = String(input.user.id);
  const loy = s.loyalty[key] ?? { stamps: 0, freeDrinksEarned: 0, totalOrders: 0 };
  loy.stamps += coffeeQty;
  loy.totalOrders += 1;
  while (loy.stamps >= 8) { loy.stamps -= 8; loy.freeDrinksEarned += 1; }
  s.loyalty[key] = loy;
  if (input.referralCode) {
    const ref = input.referralCode.replace(/^ref_/, "");
    if (!s.referrals[ref]) s.referrals[ref] = [];
    if (!s.referrals[ref].includes(key)) s.referrals[ref].push(key);
  }
  return order;
}

export function getOrders(userId?: number): Order[] {
  const s = getStore();
  return userId ? s.orders.filter((o) => o.userId === userId) : [...s.orders];
}

export function getOrder(id: string): Order | undefined {
  return getStore().orders.find((o) => o.id === id);
}

export function updateOrderStatus(id: string, status: OrderStatus): Order | undefined {
  const o = getOrder(id);
  if (!o) return undefined;
  o.status = status;
  o.updatedAt = new Date().toISOString();
  return o;
}

export function getLoyalty(userId: number): LoyaltyState {
  return getStore().loyalty[String(userId)] ?? { stamps: 0, freeDrinksEarned: 0, totalOrders: 0 };
}

export function getSubscription(userId: number): Subscription | undefined {
  return getStore().subs[String(userId)];
}

export function createSubscription(userId: number, method: "stars" | "mock"): Subscription {
  const now = new Date();
  const next = new Date(now); next.setMonth(next.getMonth() + 1);
  const sub: Subscription = {
    userId, planId: "beans-monthly", active: true,
    startedAt: now.toISOString(), nextBillingAt: next.toISOString(), method,
  };
  getStore().subs[String(userId)] = sub;
  return sub;
}

export function dailySales(dateISO: string): { date: string; count: number; revenue: number; byStatus: Record<string, number>; orders: Order[]; lowStock: { id: string; name: string; qty: number; unit: string; lowAt: number }[] } {
  const day = dateISO.slice(0, 10);
  const orders = getStore().orders.filter((o) => o.createdAt.slice(0, 10) === day && o.status !== "Cancelled");
  const revenue = orders.reduce((sum, o) => sum + o.total, 0);
  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  return { date: day, count: orders.length, revenue, byStatus, orders, lowStock: lowStockItems() };
}

export function getReferrals(userId: number): string[] {
  return getStore().referrals[String(userId)] ?? [];
}

// ================= Inventory =================

export function getInventory(): { id: string; name: string; amharicName: string; category: string; price: number; soldOut?: boolean; qty: number; unit: string; lowAt: number; low: boolean }[] {
  const s = getStore();
  return s.menu.map((m) => {
    const stock = s.inventory[m.id] ?? { qty: 0, unit: "cups", lowAt: 5 };
    return { id: m.id, name: m.name, amharicName: m.amharicName, category: m.category, price: m.price, soldOut: m.soldOut, qty: stock.qty, unit: stock.unit, lowAt: stock.lowAt, low: isLowStock(stock) };
  });
}

export function getStock(itemId: string): StockLevel | undefined {
  return getStore().inventory[itemId];
}

/** Stock left for one item (0 when unknown). */
export function stockLeft(itemId: string): number {
  return getStore().inventory[itemId]?.qty ?? 0;
}

export function lowStockItems(): { id: string; name: string; qty: number; unit: string; lowAt: number }[] {
  const s = getStore();
  return s.menu
    .filter((m) => { const st = s.inventory[m.id]; return st && st.qty <= st.lowAt; })
    .map((m) => { const st = s.inventory[m.id]; return { id: m.id, name: m.name, qty: st.qty, unit: st.unit, lowAt: st.lowAt }; });
}

/** Menu items with their live stock attached (for /api/menu). */
export function getMenuWithStock(includeHidden = false): (MenuItem & { stockLeft: number; unit: string; lowAt: number })[] {
  return getMenu(includeHidden).map((m) => {
    const st = getStore().inventory[m.id] ?? { qty: 0, unit: "cups", lowAt: 5 };
    return { ...m, stockLeft: st.qty, unit: st.unit, lowAt: st.lowAt };
  });
}

/** Validate a set of order lines against stock. Returns an error string or null. */
export function checkStock(lines: { id: string; qty: number }[]): string | null {
  const s = getStore();
  for (const line of lines) {
    const item = s.menu.find((m) => m.id === line.id);
    if (!item) return `Unknown item: ${line.id}`;
    const stock = s.inventory[line.id];
    const left = stock?.qty ?? 0;
    if (left <= 0 || item.soldOut) return `${item.name} is sold out`;
    if (line.qty > left) return `Only ${left} ${item.name} left`;
  }
  return null;
}

/** Decrement stock for a placed order; flips soldOut when an item hits 0. */
export function decrementStock(lines: { id: string; qty: number }[]): void {
  const s = getStore();
  for (const line of lines) {
    const stock = s.inventory[line.id];
    if (!stock) continue;
    stock.qty = Math.max(0, stock.qty - line.qty);
    const item = s.menu.find((m) => m.id === line.id);
    if (item) item.soldOut = stock.qty === 0;
  }
}

/** Owner restock: set an item's quantity (clears soldOut when qty > 0). */
export function setStock(itemId: string, qty: number): StockLevel | null {
  const s = getStore();
  const stock = s.inventory[itemId];
  if (!stock) return null;
  stock.qty = Math.max(0, Math.floor(qty));
  const item = s.menu.find((m) => m.id === itemId);
  if (item) item.soldOut = stock.qty === 0;
  return stock;
}

// ================= AI barista memory =================

export function getOrCreateUserMemory(userId: number, name?: string): UserMemory {
  const s = getStore();
  const key = String(userId);
  if (!s.memories[key]) {
    s.memories[key] = {
      userId, name: name || "Guest",
      nameState: "unknown", userTurns: 0,
      history: [],
      prefs: { lang: "am", favourites: [], orderCount: 0 },
      updatedAt: new Date().toISOString(),
    };
  }
  if (name) s.memories[key].name = name;
  return s.memories[key];
}

export function appendTurn(userId: number, role: "user" | "ai", text: string): UserMemory {
  const mem = getOrCreateUserMemory(userId);
  mem.history.push({ role, text, at: new Date().toISOString() });
  if (mem.history.length > MAX_MEMORY_TURNS) mem.history = mem.history.slice(-MAX_MEMORY_TURNS);
  mem.updatedAt = new Date().toISOString();
  return mem;
}

export function setUserLang(userId: number, lang: "am" | "en"): void {
  getOrCreateUserMemory(userId).prefs.lang = lang;
}

/** Learn from a completed order: favourites + order count (never throws). */
export function learnFromOrder(order: Order): void {
  try {
    const mem = getOrCreateUserMemory(order.userId, order.userName);
    mem.prefs.orderCount += 1;
    mem.prefs.lastOrderId = order.id;
    for (const line of order.lines) {
      if (!mem.prefs.favourites.includes(line.id)) mem.prefs.favourites.unshift(line.id);
    }
    mem.prefs.favourites = mem.prefs.favourites.slice(0, 8);
    mem.updatedAt = new Date().toISOString();
  } catch { /* memory must never fail an order */ }
}

// ================= Bot checkout drafts =================

export function createDraft(userId: number, lines: OrderLine[], fulfillment: Fulfillment = "pickup"): DraftOrder {
  const s = getStore();
  const id = `DRAFT-${++s.draftSeq}-${Date.now().toString(36)}`;
  const draft: DraftOrder = { id, userId, lines, fulfillment, createdAt: new Date().toISOString() };
  s.drafts[id] = draft;
  return draft;
}

export function getDraft(id: string): DraftOrder | undefined {
  return getStore().drafts[id];
}

// ================= HTML widgets (Bot API 10.4) =================

/** Record where an order's tracker widget lives, so status changes can edit it in place. */
export function setOrderTrackerWidget(orderId: string, chatId: number, messageId: number): void {
  const o = getOrder(orderId);
  if (o) o.trackerWidget = { chatId, messageId };
}

/** Server-side widget chat_data for one message (key `${chatId}:${messageId}`). */
export function getWidgetState(key: string): Record<string, unknown> {
  try {
    return JSON.parse(getStore().widgetStates[key] || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function setWidgetState(key: string, state: Record<string, unknown>): void {
  getStore().widgetStates[key] = JSON.stringify(state);
}

export function getWidgetDraftId(userId: number): string | undefined {
  return getStore().widgetDrafts[String(userId)];
}

/**
 * Add a line to the user's widget draft (created on first widget tap).
 * Merges same item+options into one line. Returns the draft and the total
 * quantity of that item across all its lines (for the widget's "Added (n)").
 */
export function addToWidgetDraft(userId: number, line: OrderLine): { draft: DraftOrder; lineQty: number } {
  const s = getStore();
  let draftId = s.widgetDrafts[String(userId)];
  let draft = draftId ? s.drafts[draftId] : undefined;
  if (!draft) {
    draft = createDraft(userId, [], "pickup");
    s.widgetDrafts[String(userId)] = draft.id;
  }
  const key = JSON.stringify([line.id, line.options ?? {}]);
  const existing = draft.lines.find((l) => JSON.stringify([l.id, l.options ?? {}]) === key);
  if (existing) existing.qty += line.qty;
  else draft.lines.push({ ...line });
  const lineQty = draft.lines.filter((l) => l.id === line.id).reduce((n, l) => n + l.qty, 0);
  return { draft, lineQty };
}

// ================= Sales-agent state (name, cart) =================

/** Count one customer message; returns the new total. */
export function noteUserTurn(userId: number): number {
  const mem = getOrCreateUserMemory(userId);
  mem.userTurns = (mem.userTurns ?? 0) + 1;
  return mem.userTurns;
}

export function setCallName(userId: number, name: string): void {
  const mem = getOrCreateUserMemory(userId);
  mem.callName = name;
  mem.nameState = "known";
}

export function setNameState(userId: number, state: NameState): void {
  getOrCreateUserMemory(userId).nameState = state;
}

/** The customer's open cart (the widget/agent draft) if it has any lines. */
export function getCart(userId: number): DraftOrder | undefined {
  const id = getWidgetDraftId(userId);
  const d = id ? getDraft(id) : undefined;
  return d && d.lines.length > 0 ? d : undefined;
}

export function clearCart(userId: number): void {
  delete getStore().widgetDrafts[String(userId)];
}

export function removeFromCart(userId: number, itemId: string): boolean {
  const d = getCart(userId);
  if (!d) return false;
  const before = d.lines.length;
  d.lines = d.lines.filter((l) => l.id !== itemId);
  return d.lines.length < before;
}

/** Set pickup/delivery (+ address) on the open cart, creating it if needed. */
export function setCartDelivery(userId: number, fulfillment: Fulfillment, address?: string): DraftOrder {
  const s = getStore();
  let d = getCart(userId);
  if (!d) {
    const id = s.widgetDrafts[String(userId)];
    d = (id ? s.drafts[id] : undefined) ?? createDraft(userId, [], "pickup");
    s.widgetDrafts[String(userId)] = d.id;
  }
  d.fulfillment = fulfillment;
  if (fulfillment === "pickup") d.address = undefined;
  else if (address) d.address = address;
  return d;
}
