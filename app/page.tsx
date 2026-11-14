"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { TelegramProvider, useTelegram } from "@/components/TelegramProvider";
import { CATEGORIES, SUBSCRIPTION_PLAN, type MenuItem } from "@/lib/data";
import { formatETB } from "@/lib/format";
import type { Order, OrderStatus } from "@/lib/store";

type View = "home" | "item" | "cart" | "checkout" | "tracking" | "loyalty" | "admin" | "subscribe";
interface CartLine { id: string; qty: number; options: Record<string, string>; }
interface LoyaltyData { stamps: number; stampsToFree: number; freeDrinksEarned: number; totalOrders: number; history: Order[]; referrals: string[]; }

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || "Alerter_nazbot";
const STATUSES: OrderStatus[] = ["Received", "Brewing", "Ready", "Out for delivery", "Completed"];

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-3xl bg-coffee-100 ${className}`} />;
}

function ItemCard({ item, onOpen }: { item: MenuItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="animate-fade-up overflow-hidden rounded-3xl bg-white text-left shadow-card transition-transform duration-150 active:scale-[0.98]">
      <div className="relative h-36 w-full">
        <Image src={item.image} alt={item.name} fill className="object-cover" sizes="(max-width: 768px) 50vw, 400px" />
        {item.soldOut && <span className="absolute left-2 top-2 rounded-full bg-coffee-900/90 px-2 py-1 text-[10px] font-bold text-white">SOLD OUT</span>}
        {item.popular && !item.soldOut && <span className="absolute left-2 top-2 rounded-full bg-coffee-400 px-2 py-1 text-[10px] font-bold text-coffee-900">★ POPULAR</span>}
      </div>
      <div className="p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-coffee-400">{item.amharicName}</p>
        <p className="line-clamp-1 text-sm font-bold leading-tight">{item.name}</p>
        <p className="mt-1 text-sm font-extrabold text-coffee-500">{formatETB(item.price)}</p>
      </div>
    </button>
  );
}

function StoreApp() {
  const { user, initData, isTelegram, startParam, haptic, setMainButton, setBackButton } = useTelegram();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("All");
  const [view, setView] = useState<View>("home");
  const [itemId, setItemId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [tip, setTip] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"telebirr" | "chapa" | "stars">("telebirr");
  const [payStep, setPayStep] = useState<"method" | "pay">("method");
  const [mockCode, setMockCode] = useState("");
  const [referral, setReferral] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [tracked, setTracked] = useState<Order | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [sub, setSub] = useState<{ active: boolean; nextBillingAt?: string } | null>(null);
  const [adminOrders, setAdminOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<{ count: number; revenue: number; byStatus: Record<string, number> } | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [toast, setToast] = useState("");
  const [qty, setQty] = useState(1);
  const [selOptions, setSelOptions] = useState<Record<string, string>>({});
  const initDataRef = useRef(initData);
  initDataRef.current = initData;

  const userId = user?.id ?? 999999;
  const demoOwner = useMemo(() => new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("demoOwner") === "1", []);

  const api = useCallback(async (path: string, opts: RequestInit = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as Record<string, string> | undefined) };
    if (initDataRef.current) headers["x-telegram-init-data"] = initDataRef.current;
    if (demoOwner) headers["x-demo-owner"] = "1";
    const res = await fetch(path, { ...opts, headers });
    return res.json() as Promise<Record<string, unknown>>;
  }, [demoOwner]);

  // Load menu + deep link (startapp) + owner probe
  useEffect(() => {
    fetch("/api/menu").then((r) => r.json()).then((d) => { setMenu((d.items ?? []) as MenuItem[]); setLoading(false); }).catch(() => setLoading(false));
    try {
      const saved = localStorage.getItem("buna-cart");
      if (saved) setCart(JSON.parse(saved) as CartLine[]);
      const savedRef = localStorage.getItem("buna-referral");
      if (savedRef) setReferral(savedRef);
    } catch { /* ignore */ }
    api("/api/admin/sales").then((d) => { if (d.ok) { setIsOwner(true); setSales(d as unknown as { count: number; revenue: number; byStatus: Record<string, number> }); } }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!startParam) return;
    if (startParam.startsWith("ref_")) {
      setReferral(startParam);
      try { localStorage.setItem("buna-referral", startParam); } catch { /* ignore */ }
      setToast("🎁 Referral applied — you both get a free drink!");
    } else if (startParam.startsWith("item_")) {
      setItemId(startParam.replace("item_", ""));
      setView("item");
    }
  }, [startParam]);

  useEffect(() => {
    try { localStorage.setItem("buna-cart", JSON.stringify(cart)); } catch { /* ignore */ }
  }, [cart]);

  // Last order + loyalty
  useEffect(() => {
    api(`/api/orders?userId=${userId}`).then((d) => {
      const orders = (d.orders ?? []) as Order[];
      if (orders[0]) setLastOrder(orders[0]);
    }).catch(() => undefined);
    api(`/api/loyalty?userId=${userId}`).then((d) => { if (d.ok) setLoyalty(d as unknown as LoyaltyData); }).catch(() => undefined);
    api(`/api/subscription?userId=${userId}`).then((d) => { if ((d as { subscription?: unknown }).subscription) setSub((d as { subscription: { active: boolean; nextBillingAt: string } }).subscription); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Tracking poll
  useEffect(() => {
    if (view !== "tracking" || !trackingId) return;
    let alive = true;
    const poll = () => fetch(`/api/orders/${trackingId}`).then((r) => r.json()).then((d) => { if (alive && d.order) setTracked(d.order as Order); }).catch(() => undefined);
    poll();
    const t = setInterval(poll, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [view, trackingId]);

  const cartTotal = useMemo(() => cart.reduce((sum, l) => {
    const item = menu.find((m) => m.id === l.id);
    if (!item) return sum;
    let price = item.price;
    for (const g of item.options ?? []) {
      const c = g.choices.find((x) => x.label === l.options[g.name]);
      if (c) price += c.priceDelta;
    }
    return sum + price * l.qty;
  }, 0), [cart, menu]);

  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.qty, 0), [cart]);

  const addToCart = useCallback((id: string, options: Record<string, string>, q: number) => {
    setCart((prev) => {
      const key = JSON.stringify(options);
      const idx = prev.findIndex((l) => l.id === id && JSON.stringify(l.options) === key);
      if (idx >= 0) { const next = [...prev]; next[idx] = { ...next[idx], qty: next[idx].qty + q }; return next; }
      return [...prev, { id, qty: q, options }];
    });
    haptic("medium");
    setToast("Added to cart ☕");
    setTimeout(() => setToast(""), 1800);
  }, [haptic]);

  const go = useCallback((v: View) => { setView(v); window.scrollTo({ top: 0 }); }, []);

  const openItem = useCallback((id: string) => {
    const item = menu.find((m) => m.id === id);
    setItemId(id); setQty(1);
    const defaults: Record<string, string> = {};
    for (const g of item?.options ?? []) defaults[g.name] = g.choices[0].label;
    setSelOptions(defaults);
    go("item");
  }, [menu, go]);

  // MainButton / BackButton wiring
  const placeOrder = useCallback(async () => {
    if (cart.length === 0 || placing) return;
    setPlacing(true);
    try {
      const d = await api("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          initData: initDataRef.current || undefined,
          items: cart.map((l) => ({ id: l.id, qty: l.qty, options: l.options })),
          fulfillment, address, notes, tip, paymentMethod,
          referralCode: referral ?? undefined,
        }),
      });
      if (!d.ok) { setToast(String(d.error ?? "Order failed")); return; }
      const order = d.order as Order;
      setMockCode(String((d as { mockPayCode?: string }).mockPayCode ?? ""));
      setLastOrder(order); setTrackingId(order.id); setTracked(order);
      setCart([]); setPayStep("method");
      haptic("success");
      go("tracking");
    } finally { setPlacing(false); }
  }, [cart, placing, api, fulfillment, address, notes, tip, paymentMethod, referral, haptic, go]);

  useEffect(() => {
    if (view === "cart" && cart.length > 0) setMainButton(`Checkout • ${formatETB(cartTotal)}`, () => go("checkout"));
    else if (view === "checkout") setMainButton(placing ? "Placing order…" : `Place order • ${formatETB(cartTotal + tip + (fulfillment === "delivery" ? 50 : 0))}`, () => { if (payStep === "method") setPayStep("pay"); else void placeOrder(); });
    else setMainButton(null);
    setBackButton(view !== "home", () => go(view === "item" ? "home" : view === "checkout" ? "cart" : view === "tracking" ? "home" : "home"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, cartTotal, cart.length, placing, payStep, tip, fulfillment]);

  const filtered = category === "All" ? menu : menu.filter((m) => m.category === category);
  const popular = menu.filter((m) => m.popular && !m.hidden);
  const selected = menu.find((m) => m.id === itemId);
  const referralLink = `https://t.me/${BOT_USERNAME}/shop?startapp=ref_${userId}`;

  const shareReferral = async () => {
    haptic("light");
    try {
      if (navigator.share) await navigator.share({ title: "Buna Corner", text: "Invite a friend, both get a free drink at Buna Corner ☕", url: referralLink });
      else { await navigator.clipboard.writeText(referralLink); setToast("Referral link copied!"); setTimeout(() => setToast(""), 1800); }
    } catch { /* user cancelled */ }
  };

  const loadAdmin = useCallback(() => {
    api("/api/orders").then((d) => { if (d.ok) setAdminOrders((d.orders ?? []) as Order[]); }).catch(() => undefined);
    api("/api/admin/sales").then((d) => { if (d.ok) setSales(d as unknown as { count: number; revenue: number; byStatus: Record<string, number> }); }).catch(() => undefined);
  }, [api]);

  useEffect(() => { if (view === "admin") loadAdmin(); }, [view, loadAdmin]);

  const setStatus = async (id: string, status: OrderStatus) => {
    const d = await api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (d.ok) { haptic("success"); loadAdmin(); setToast(`Order ${id} → ${status}`); setTimeout(() => setToast(""), 1800); }
    else setToast(String(d.error ?? "Update failed"));
  };

  const toggleSoldOut = async (item: MenuItem) => {
    await api("/api/admin/menu", { method: "POST", body: JSON.stringify({ ...item, soldOut: !item.soldOut }) });
    const d = await fetch("/api/menu").then((r) => r.json()).catch(() => null);
    if (d?.items) setMenu(d.items as MenuItem[]);
    loadAdmin();
  };

  const postToChannel = async (item: MenuItem) => {
    const d = await api("/api/channel/post", { method: "POST", body: JSON.stringify({ itemId: item.id }) });
    setToast(d.ok ? "Posted to channel ✅" : `Channel post failed: ${String((d as { reason?: string }).reason ?? "unknown")}`);
    setTimeout(() => setToast(""), 2500);
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-md bg-coffee-50 pb-24">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-coffee-900/95 px-4 pb-3 pt-4 text-white backdrop-blur">
        <div className="flex items-center justify-between">
          <button onClick={() => go("home")} className="text-left">
            <p className="text-lg font-black leading-none tracking-tight">☕ Buna Corner</p>
            <p className="mt-0.5 text-[11px] text-coffee-200">Addis Ababa • Bole • Open 7:00–21:00</p>
          </button>
          <button onClick={() => go("cart")} className="relative rounded-full bg-coffee-400 px-3 py-2 text-sm font-bold text-coffee-900 active:scale-95">
            🛒 Cart {cartCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-black">{cartCount}</span>}
          </button>
        </div>
        {!isTelegram && (
          <p className="mt-2 rounded-xl bg-coffee-700 px-3 py-2 text-[11px] leading-snug text-coffee-100">
            Demo mode — open in Telegram for the full experience (haptics, MainButton, verified login).
          </p>
        )}
        {referral && <p className="mt-2 rounded-xl bg-coffee-400/20 px-3 py-1.5 text-[11px] font-semibold text-coffee-300">🎁 Referral applied — free drink for you and your friend!</p>}
      </header>

      {toast && <div className="fixed left-1/2 top-16 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-coffee-900 px-4 py-2 text-xs font-bold text-white shadow-card">{toast}</div>}

      {/* ============ HOME ============ */}
      {view === "home" && (
        <main className="animate-fade-up px-4 pt-4">
          <section className="overflow-hidden rounded-3xl bg-coffee-900 text-white shadow-card">
            <div className="relative h-44">
              <Image src="https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=800&auto=format&fit=crop" alt="Buna Corner coffee" fill className="object-cover opacity-90" priority />
              <div className="absolute inset-0 bg-gradient-to-t from-coffee-900 via-coffee-900/40 to-transparent" />
              <div className="absolute bottom-3 left-4 right-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-coffee-300">Fresh from Yirgacheffe</p>
                <h1 className="text-2xl font-black leading-tight">Good mornings start with buna.</h1>
                <p className="text-xs text-coffee-100">Traditional jebena, modern espresso — roasted in-house.</p>
              </div>
            </div>
            <div className="flex gap-2 px-4 pb-4 pt-3">
              <button onClick={() => go("loyalty")} className="flex-1 rounded-2xl bg-coffee-400 py-2.5 text-sm font-bold text-coffee-900 active:scale-[0.98]">🎟️ My stamps</button>
              <button onClick={() => go("subscribe")} className="flex-1 rounded-2xl bg-white/15 py-2.5 text-sm font-bold text-white active:scale-[0.98]">🫘 Beans / month</button>
            </div>
          </section>

          {lastOrder && (
            <button onClick={() => { setCart(lastOrder.lines.map((l) => ({ id: l.id, qty: l.qty, options: l.options ?? {} }))); go("cart"); }} className="mt-4 flex w-full items-center gap-3 rounded-3xl bg-white p-3 text-left shadow-card active:scale-[0.99]">
              <span className="text-2xl">🔁</span>
              <span className="flex-1">
                <span className="block text-sm font-bold">Reorder last order</span>
                <span className="block text-xs text-coffee-500">{lastOrder.id} • {lastOrder.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")} • {formatETB(lastOrder.total)}</span>
              </span>
              <span className="text-coffee-400">›</span>
            </button>
          )}

          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {["All", ...CATEGORIES].map((c) => (
              <button key={c} onClick={() => { setCategory(c); haptic("light"); }} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ${category === c ? "bg-coffee-900 text-white" : "bg-white text-coffee-700 shadow-card"}`}>{c}</button>
            ))}
          </div>

          <h2 className="mt-5 text-base font-black">Popular right now</h2>
          {loading ? (
            <div className="mt-3 grid grid-cols-2 gap-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {popular.map((item) => <ItemCard key={item.id} item={item} onOpen={() => openItem(item.id)} />)}
            </div>
          )}

          <h2 className="mt-6 text-base font-black">{category === "All" ? "Full menu" : category}</h2>
          {loading ? <div className="mt-3 space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : (
            <div className="mt-3 space-y-3">
              {filtered.map((item) => (
                <button key={item.id} onClick={() => openItem(item.id)} className="flex w-full items-center gap-3 rounded-3xl bg-white p-3 text-left shadow-card active:scale-[0.99]">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl"><Image src={item.image} alt={item.name} fill className="object-cover" sizes="64px" /></div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{item.name}</span>
                    <span className="block truncate text-xs text-coffee-500">{item.description}</span>
                    <span className="mt-0.5 block text-sm font-extrabold text-coffee-500">{formatETB(item.price)}{item.soldOut ? " • Sold out" : ""}</span>
                  </span>
                  <span className="rounded-full bg-coffee-100 px-3 py-1.5 text-sm font-black text-coffee-600">+</span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-6 rounded-3xl bg-coffee-100 p-4">
            <p className="text-sm font-black">Invite a friend, both get a free drink 🎁</p>
            <p className="mt-1 text-xs leading-relaxed text-coffee-600">Share your link — when your friend orders, you both earn a free macchiato.</p>
            <button onClick={shareReferral} className="mt-3 w-full rounded-2xl bg-coffee-900 py-2.5 text-sm font-bold text-white active:scale-[0.98]">Share my invite link</button>
          </div>
        </main>
      )}

      {/* ============ ITEM ============ */}
      {view === "item" && selected && (
        <main className="animate-fade-up px-4 pt-4">
          <div className="relative h-64 overflow-hidden rounded-3xl"><Image src={selected.image} alt={selected.name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 400px" /></div>
          <h1 className="mt-4 text-2xl font-black leading-tight">{selected.name}</h1>
          <p className="text-sm font-semibold text-coffee-400">{selected.amharicName} • {selected.category}</p>
          <p className="mt-2 text-sm leading-relaxed text-coffee-700">{selected.description}</p>
          {selected.options?.map((group) => (
            <div key={group.name} className="mt-4">
              <p className="text-xs font-black uppercase tracking-wide text-coffee-500">{group.name}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.choices.map((c) => (
                  <button key={c.label} onClick={() => { setSelOptions((p) => ({ ...p, [group.name]: c.label })); haptic("light"); }} className={`rounded-full px-4 py-2 text-sm font-bold ${selOptions[group.name] === c.label ? "bg-coffee-900 text-white" : "bg-white shadow-card"}`}>
                    {c.label}{c.priceDelta > 0 ? ` +${c.priceDelta}` : ""}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-5 flex items-center justify-between">
            <div className="flex items-center gap-3 rounded-full bg-white px-2 py-1.5 shadow-card">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex h-8 w-8 items-center justify-center rounded-full bg-coffee-100 text-lg font-black">−</button>
              <span className="w-6 text-center font-black">{qty}</span>
              <button onClick={() => setQty((q) => Math.min(20, q + 1))} className="flex h-8 w-8 items-center justify-center rounded-full bg-coffee-100 text-lg font-black">+</button>
            </div>
            <p className="text-xl font-black">{formatETB((selected.price + (selected.options ?? []).reduce((s, g) => s + (g.choices.find((c) => c.label === selOptions[g.name])?.priceDelta ?? 0), 0)) * qty)}</p>
          </div>
          <button disabled={selected.soldOut} onClick={() => { addToCart(selected.id, selOptions, qty); go("cart"); }} className="mt-4 w-full rounded-2xl bg-coffee-900 py-3.5 text-sm font-bold text-white disabled:opacity-40 active:scale-[0.99]">
            {selected.soldOut ? "Sold out" : "Add to cart"}
          </button>
        </main>
      )}

      {/* ============ CART ============ */}
      {view === "cart" && (
        <main className="animate-fade-up px-4 pt-4">
          <h1 className="text-2xl font-black">Your cart</h1>
          {cart.length === 0 ? (
            <div className="mt-8 rounded-3xl bg-white p-8 text-center shadow-card">
              <p className="text-4xl">☕</p>
              <p className="mt-2 font-bold">Your cart is empty</p>
              <p className="mt-1 text-sm text-coffee-500">Add a macchiato or two — you know you want to.</p>
              <button onClick={() => go("home")} className="mt-4 rounded-2xl bg-coffee-900 px-6 py-2.5 text-sm font-bold text-white">Browse menu</button>
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-3">
                {cart.map((line, i) => {
                  const item = menu.find((m) => m.id === line.id);
                  if (!item) return null;
                  let price = item.price;
                  for (const g of item.options ?? []) { const c = g.choices.find((x) => x.label === line.options[g.name]); if (c) price += c.priceDelta; }
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-3xl bg-white p-3 shadow-card">
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl"><Image src={item.image} alt={item.name} fill className="object-cover" sizes="56px" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold">{item.name}</p>
                        <p className="text-xs text-coffee-500">{Object.values(line.options).join(" • ") || "Standard"}</p>
                        <p className="text-sm font-extrabold text-coffee-500">{formatETB(price * line.qty)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setCart((p) => p.map((l, j) => j === i ? { ...l, qty: Math.max(1, l.qty - 1) } : l))} className="flex h-7 w-7 items-center justify-center rounded-full bg-coffee-100 font-black">−</button>
                        <span className="w-5 text-center text-sm font-black">{line.qty}</span>
                        <button onClick={() => setCart((p) => p.map((l, j) => j === i ? { ...l, qty: Math.min(20, l.qty + 1) } : l))} className="flex h-7 w-7 items-center justify-center rounded-full bg-coffee-100 font-black">+</button>
                        <button onClick={() => setCart((p) => p.filter((_, j) => j !== i))} className="ml-1 text-coffee-400">✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 rounded-3xl bg-white p-4 shadow-card">
                <p className="text-xs font-black uppercase tracking-wide text-coffee-500">Fulfilment</p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["pickup", "delivery"] as const).map((f) => (
                    <button key={f} onClick={() => { setFulfillment(f); haptic("light"); }} className={`rounded-2xl py-2.5 text-sm font-bold capitalize ${fulfillment === f ? "bg-coffee-900 text-white" : "bg-coffee-100"}`}>{f === "pickup" ? "🏃 Pickup" : "🛵 Delivery"}</button>
                  ))}
                </div>
                {fulfillment === "delivery" && (
                  <div className="mt-3">
                    <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address — e.g. Bole, Friendship Bldg, 4th floor" className="w-full rounded-2xl border border-coffee-100 bg-coffee-50 px-3 py-2.5 text-sm outline-none focus:border-coffee-400" />
                    <button onClick={() => {
                      const wa = window.Telegram?.WebApp;
                      if (wa?.requestLocation) wa.requestLocation((loc) => { if (loc) setAddress(`Lat ${loc.latitude.toFixed(5)}, Lng ${loc.longitude.toFixed(5)}`); });
                      else setToast("Location sharing needs Telegram — type your address instead");
                    }} className="mt-2 w-full rounded-2xl bg-coffee-100 py-2 text-xs font-bold">📍 Share my location</button>
                  </div>
                )}
                <p className="mt-4 text-xs font-black uppercase tracking-wide text-coffee-500">Tip the barista</p>
                <div className="mt-2 flex gap-2">
                  {[0, 10, 20, 50].map((t) => (
                    <button key={t} onClick={() => setTip(t)} className={`flex-1 rounded-full py-2 text-sm font-bold ${tip === t ? "bg-coffee-900 text-white" : "bg-coffee-100"}`}>{t === 0 ? "No tip" : `${t} ETB`}</button>
                  ))}
                </div>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes — e.g. extra hot, no sugar…" rows={2} className="mt-3 w-full rounded-2xl border border-coffee-100 bg-coffee-50 px-3 py-2.5 text-sm outline-none focus:border-coffee-400" />
                <div className="mt-3 space-y-1 text-sm">
                  <p className="flex justify-between"><span>Subtotal</span><span className="font-bold">{formatETB(cartTotal)}</span></p>
                  {fulfillment === "delivery" && <p className="flex justify-between"><span>Delivery</span><span className="font-bold">{formatETB(50)}</span></p>}
                  <p className="flex justify-between"><span>Tip</span><span className="font-bold">{formatETB(tip)}</span></p>
                  <p className="flex justify-between border-t border-coffee-100 pt-2 text-base font-black"><span>Total</span><span>{formatETB(cartTotal + tip + (fulfillment === "delivery" ? 50 : 0))}</span></p>
                </div>
                <button onClick={() => go("checkout")} className="mt-4 w-full rounded-2xl bg-coffee-900 py-3 text-sm font-bold text-white active:scale-[0.99]">Checkout • {formatETB(cartTotal + tip + (fulfillment === "delivery" ? 50 : 0))}</button>
              </div>
            </>
          )}
        </main>
      )}

      {/* ============ CHECKOUT ============ */}
      {view === "checkout" && (
        <main className="animate-fade-up px-4 pt-4">
          <h1 className="text-2xl font-black">Checkout</h1>
          {payStep === "method" ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm text-coffee-600">Total to pay: <b className="text-coffee-900">{formatETB(cartTotal + tip + (fulfillment === "delivery" ? 50 : 0))}</b> • {fulfillment === "pickup" ? "Pickup at Bole" : `Delivery to ${address || "your address"}`}</p>
              {(["telebirr", "chapa", "stars"] as const).map((m) => (
                <button key={m} onClick={() => { setPaymentMethod(m); haptic("light"); }} className={`flex w-full items-center gap-3 rounded-3xl p-4 text-left shadow-card ${paymentMethod === m ? "bg-coffee-900 text-white" : "bg-white"}`}>
                  <span className="text-2xl">{m === "telebirr" ? "📱" : m === "chapa" ? "💳" : "⭐"}</span>
                  <span className="flex-1"><span className="block text-sm font-bold capitalize">{m === "stars" ? "Telegram Stars" : m}</span>
                  <span className={`block text-xs ${paymentMethod === m ? "text-coffee-200" : "text-coffee-500"}`}>{m === "stars" ? "Pay with Stars inside Telegram" : m === "telebirr" ? "Pay with Telebirr mobile money" : "Pay by card via Chapa"}</span></span>
                  <span>{paymentMethod === m ? "●" : "○"}</span>
                </button>
              ))}
              <p className="rounded-2xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-800">Demo payment — no real money moves. The Telebirr/Chapa screen is structured so a real gateway can be swapped in later (see README).</p>
              <button onClick={() => setPayStep("pay")} className="w-full rounded-2xl bg-coffee-900 py-3.5 text-sm font-bold text-white active:scale-[0.99]">Continue to payment</button>
            </div>
          ) : (
            <div className="mt-4 rounded-3xl bg-white p-5 text-center shadow-card">
              <p className="text-4xl">{paymentMethod === "stars" ? "⭐" : "📱"}</p>
              <p className="mt-2 text-lg font-black">{paymentMethod === "stars" ? "Pay with Telegram Stars" : `Pay with ${paymentMethod === "telebirr" ? "Telebirr" : "Chapa"}`}</p>
              <p className="mt-1 text-2xl font-black text-coffee-500">{formatETB(cartTotal + tip + (fulfillment === "delivery" ? 50 : 0))}</p>
              {paymentMethod !== "stars" ? (
                <>
                  <p className="mt-3 text-xs text-coffee-500">Demo mock — in production this opens the real {paymentMethod} checkout. Your mock payment code:</p>
                  <p className="mx-auto mt-2 w-fit rounded-2xl bg-coffee-100 px-4 py-2 font-mono text-sm font-bold tracking-widest">BC-PAY-{String(cartTotal).padStart(4, "0")}</p>
                  <p className="mt-2 text-[11px] text-coffee-400">Send the amount to Buna Corner, then tap “I paid”.</p>
                </>
              ) : <p className="mt-3 text-xs text-coffee-500">Demo Stars flow — in production this opens a Telegram Stars invoice via the bot.</p>}
              <button disabled={placing} onClick={() => void placeOrder()} className="mt-5 w-full rounded-2xl bg-coffee-900 py-3.5 text-sm font-bold text-white disabled:opacity-50 active:scale-[0.99]">{placing ? "Placing order…" : paymentMethod === "stars" ? "Pay with Stars & place order" : "I paid — place my order"}</button>
              <button onClick={() => setPayStep("method")} className="mt-2 w-full py-2 text-xs font-bold text-coffee-500">← Change payment method</button>
            </div>
          )}
        </main>
      )}

      {/* ============ TRACKING ============ */}
      {view === "tracking" && tracked && (
        <main className="animate-fade-up px-4 pt-4">
          <h1 className="text-2xl font-black">Order {tracked.id}</h1>
          <p className="text-sm text-coffee-500">{tracked.fulfillment === "pickup" ? "Pickup at Bole" : `Delivery to ${tracked.address || "your address"}`} • {formatETB(tracked.total)} • {tracked.paymentMethod}</p>
          <div className="mt-5 space-y-0">
            {STATUSES.slice(0, 4).map((s, i) => {
              const idx = STATUSES.indexOf(tracked.status);
              const done = i <= idx && tracked.status !== "Cancelled";
              const current = s === tracked.status;
              return (
                <div key={s} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full text-sm ${done ? "bg-coffee-900 text-white" : "bg-coffee-100 text-coffee-400"}`}>{done ? "✓" : ["📥", "☕", "✅", "🛵"][i]}</span>
                    {i < 3 && <span className={`w-0.5 flex-1 ${done ? "bg-coffee-900" : "bg-coffee-100"}`} style={{ minHeight: 28 }} />}
                  </div>
                  <div className="pb-6 pt-2">
                    <p className={`text-sm font-bold ${current ? "text-coffee-900" : done ? "text-coffee-700" : "text-coffee-400"}`}>{s}{current ? " — now" : ""}</p>
                    <p className="text-xs text-coffee-500">{["We received your order", "Your coffee is being brewed", "Ready for pickup", "On its way to you"][i]}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="rounded-3xl bg-white p-4 shadow-card">
            {tracked.lines.map((l) => <p key={l.id} className="flex justify-between py-1 text-sm"><span>{l.qty}× {l.name}</span><span className="font-bold">{formatETB(l.unitPrice * l.qty)}</span></p>)}
            <p className="flex justify-between border-t border-coffee-100 pt-2 text-sm font-black"><span>Total</span><span>{formatETB(tracked.total)}</span></p>
          </div>
          <button onClick={shareReferral} className="mt-4 w-full rounded-2xl bg-coffee-900 py-3 text-sm font-bold text-white active:scale-[0.99]">🎁 Invite a friend — both get a free drink</button>
          <button onClick={() => go("home")} className="mt-2 w-full py-2 text-sm font-bold text-coffee-500">Back to menu</button>
        </main>
      )}

      {/* ============ LOYALTY ============ */}
      {view === "loyalty" && (
        <main className="animate-fade-up px-4 pt-4">
          <h1 className="text-2xl font-black">Loyalty</h1>
          <div className="mt-4 rounded-3xl bg-coffee-900 p-5 text-white shadow-card">
            <p className="text-sm font-bold">☕ Stamp card — every 8th coffee free</p>
            <div className="mt-4 grid grid-cols-8 gap-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} className={`flex aspect-square items-center justify-center rounded-full text-sm ${i < (loyalty?.stamps ?? 0) ? "bg-coffee-400 text-coffee-900" : "bg-white/15 text-white/60"}`}>{i < (loyalty?.stamps ?? 0) ? "●" : "○"}</span>
              ))}
            </div>
            <p className="mt-3 text-xs text-coffee-200">{loyalty?.stamps ?? 0} / 8 stamps • {loyalty?.stampsToFree ?? 8} more to a free coffee • {loyalty?.freeDrinksEarned ?? 0} free drink(s) earned • {loyalty?.totalOrders ?? 0} orders</p>
          </div>
          <h2 className="mt-6 text-base font-black">Order history</h2>
          <div className="mt-3 space-y-3">
            {(loyalty?.history ?? []).length === 0 && <p className="rounded-3xl bg-white p-4 text-sm text-coffee-500 shadow-card">No orders yet — your first macchiato is waiting.</p>}
            {(loyalty?.history ?? []).map((o) => (
              <button key={o.id} onClick={() => { setTrackingId(o.id); setTracked(o); go("tracking"); }} className="flex w-full items-center justify-between rounded-3xl bg-white p-4 text-left shadow-card active:scale-[0.99]">
                <span><span className="block text-sm font-bold">{o.id} • {formatETB(o.total)}</span><span className="block text-xs text-coffee-500">{o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")}</span></span>
                <span className="rounded-full bg-coffee-100 px-3 py-1 text-xs font-bold text-coffee-700">{o.status}</span>
              </button>
            ))}
          </div>
        </main>
      )}

      {/* ============ SUBSCRIBE ============ */}
      {view === "subscribe" && (
        <main className="animate-fade-up px-4 pt-4">
          <h1 className="text-2xl font-black">Beans of the Month</h1>
          <div className="mt-4 rounded-3xl bg-white p-5 shadow-card">
            <p className="text-3xl">🫘</p>
            <p className="mt-2 text-lg font-black">{SUBSCRIPTION_PLAN.name} — {formatETB(SUBSCRIPTION_PLAN.price)}/mo</p>
            <p className="mt-1 text-sm leading-relaxed text-coffee-600">{SUBSCRIPTION_PLAN.description}</p>
            <ul className="mt-3 space-y-1.5 text-sm">{SUBSCRIPTION_PLAN.perks.map((p) => <li key={p}>✓ {p}</li>)}</ul>
            {sub?.active ? (
              <p className="mt-4 rounded-2xl bg-green-50 p-3 text-sm font-bold text-green-800">✅ Subscribed — next beans {sub.nextBillingAt ? new Date(sub.nextBillingAt).toLocaleDateString() : ""}</p>
            ) : (
              <button onClick={async () => { const d = await api("/api/subscription", { method: "POST", body: JSON.stringify({ method: "mock" }) }); if (d.ok) { setSub((d as { subscription: { active: boolean; nextBillingAt: string } }).subscription); haptic("success"); setToast("Subscribed! 🎉"); setTimeout(() => setToast(""), 1800); } }} className="mt-4 w-full rounded-2xl bg-coffee-900 py-3 text-sm font-bold text-white active:scale-[0.99]">Subscribe — {formatETB(SUBSCRIPTION_PLAN.price)}/month (demo)</button>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-coffee-400">Demo subscription. Real Telegram Stars subscriptions need a bot invoice flow — the API is structured for it (POST /api/subscription with method “stars”).</p>
          </div>
        </main>
      )}

      {/* ============ ADMIN ============ */}
      {view === "admin" && (
        <main className="animate-fade-up px-4 pt-4">
          <h1 className="text-2xl font-black">Owner dashboard</h1>
          {sales && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-3xl bg-white p-3 text-center shadow-card"><p className="text-lg font-black">{sales.count}</p><p className="text-[11px] text-coffee-500">Orders today</p></div>
              <div className="rounded-3xl bg-white p-3 text-center shadow-card"><p className="text-lg font-black">{formatETB(sales.revenue)}</p><p className="text-[11px] text-coffee-500">Revenue today</p></div>
              <div className="rounded-3xl bg-white p-3 text-center shadow-card"><p className="text-lg font-black">{sales.byStatus["Ready"] ?? 0}</p><p className="text-[11px] text-coffee-500">Ready</p></div>
            </div>
          )}
          <h2 className="mt-6 text-base font-black">Incoming orders</h2>
          <div className="mt-3 space-y-3">
            {adminOrders.length === 0 && <p className="rounded-3xl bg-white p-4 text-sm text-coffee-500 shadow-card">No orders yet today.</p>}
            {adminOrders.map((o) => (
              <div key={o.id} className="rounded-3xl bg-white p-4 shadow-card">
                <div className="flex justify-between"><p className="text-sm font-black">{o.id} • {o.userName}</p><span className="rounded-full bg-coffee-100 px-2 py-0.5 text-xs font-bold">{o.status}</span></div>
                <p className="mt-1 text-xs text-coffee-500">{o.lines.map((l) => `${l.qty}× ${l.name}`).join(", ")} • {formatETB(o.total)} • {o.fulfillment}{o.notes ? ` • “${o.notes}”` : ""}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {STATUSES.map((s) => (
                    <button key={s} onClick={() => void setStatus(o.id, s)} className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${o.status === s ? "bg-coffee-900 text-white" : "bg-coffee-100"}`}>{s}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <h2 className="mt-6 text-base font-black">Menu management</h2>
          <div className="mt-3 space-y-2">
            {menu.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-3xl bg-white p-3 shadow-card">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.name}</p><p className="text-xs text-coffee-500">{formatETB(item.price)}{item.soldOut ? " • SOLD OUT" : ""}</p></div>
                <button onClick={() => void toggleSoldOut(item)} className="rounded-full bg-coffee-100 px-3 py-1.5 text-[11px] font-bold">{item.soldOut ? "Back in stock" : "Mark sold out"}</button>
                <button onClick={() => void postToChannel(item)} className="rounded-full bg-coffee-900 px-3 py-1.5 text-[11px] font-bold text-white">📣 Post</button>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-coffee-400">Channel posting needs BOT_TOKEN + CHANNEL_ID (and the bot as channel admin). Without them the button returns a clear error instead of crashing.</p>
        </main>
      )}

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-1/2 z-20 flex w-full max-w-md -translate-x-1/2 justify-around border-t border-coffee-100 bg-white/95 px-2 py-2 backdrop-blur" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        {([["home", "🏠", "Home"], ["loyalty", "🎟️", "Stamps"], ["subscribe", "🫘", "Beans"], ...(isOwner || demoOwner ? [["admin", "🧑‍🍳", "Owner"] as [View, string, string]] : [])] as [View, string, string][]).map(([v, icon, label]) => (
          <button key={v} onClick={() => go(v)} className={`flex flex-col items-center px-3 py-1 text-[11px] font-bold ${view === v ? "text-coffee-600" : "text-coffee-400"}`}>
            <span className="text-lg leading-none">{icon}</span>{label}
          </button>
        ))}
        <button onClick={() => go("cart")} className={`flex flex-col items-center px-3 py-1 text-[11px] font-bold ${view === "cart" ? "text-coffee-600" : "text-coffee-400"}`}>
          <span className="text-lg leading-none">🛒</span>Cart{cartCount > 0 ? ` (${cartCount})` : ""}
        </button>
      </nav>
    </div>
  );
}

export default function Page() {
  return (
    <TelegramProvider>
      <StoreApp />
    </TelegramProvider>
  );
}
