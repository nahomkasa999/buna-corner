import { MENU_ITEMS, type MenuItem } from "./data";
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
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyState { stamps: number; freeDrinksEarned: number; totalOrders: number; }
export interface Subscription { userId: number; planId: string; active: boolean; startedAt: string; nextBillingAt: string; method: "stars" | "mock"; }

declare global {
  // eslint-disable-next-line no-var
  var __bunaStore: {
    menu: MenuItem[];
    orders: Order[];
    loyalty: Record<string, LoyaltyState>;
    subs: Record<string, Subscription>;
    referrals: Record<string, string[]>; // referrerId -> referred user ids
    orderSeq: number;
  } | undefined;
}

function getStore() {
  if (!globalThis.__bunaStore) {
    globalThis.__bunaStore = {
      menu: MENU_ITEMS.map((m) => ({ ...m, options: m.options?.map((o) => ({ ...o, choices: [...o.choices] })) })),
      orders: [],
      loyalty: {},
      subs: {},
      referrals: {},
      orderSeq: 1000,
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

export function dailySales(dateISO: string): { date: string; count: number; revenue: number; byStatus: Record<string, number>; orders: Order[] } {
  const day = dateISO.slice(0, 10);
  const orders = getStore().orders.filter((o) => o.createdAt.slice(0, 10) === day && o.status !== "Cancelled");
  const revenue = orders.reduce((sum, o) => sum + o.total, 0);
  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  return { date: day, count: orders.length, revenue, byStatus, orders };
}

export function getReferrals(userId: number): string[] {
  return getStore().referrals[String(userId)] ?? [];
}
