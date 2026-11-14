// Offline checks for Bot API 10.4 HTML widgets — no key, no token, no network.
// Run: npx tsx scripts/test-widgets.ts
// Exits non-zero on any failure.
import {
  buildItemWidget,
  buildOrderWidget,
  handleWidgetQuery,
  isWidgetQuery,
  sendItemWidget,
  widgetSizes,
  widgetWithinLimits,
  type WidgetQuery,
} from "../lib/widget";
import {
  createOrder,
  getDraft,
  getMenuItem,
  getWidgetDraftId,
  stockLeft,
} from "../lib/store";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  const macchiato = getMenuItem("macchiato")!;
  const croissant = getMenuItem("croissant")!;

  // --- 1. Byte sizes ---
  const itemHtml = buildItemWidget(macchiato, stockLeft("macchiato"));
  const itemSizes = widgetSizes(itemHtml);
  console.log(`item widget (macchiato): raw=${itemSizes.raw} compressed=${itemSizes.compressed}`);
  check("item widget raw <= 32768", itemSizes.raw <= 32768);
  check("item widget compressed <= 4096", itemSizes.compressed <= 4096);
  check("item widget within limits", widgetWithinLimits(itemHtml));

  const plainHtml = buildItemWidget(croissant, stockLeft("croissant"));
  const plainSizes = widgetSizes(plainHtml);
  console.log(`item widget (croissant, no sizes): raw=${plainSizes.raw} compressed=${plainSizes.compressed}`);
  check("croissant widget compressed <= 4096", plainSizes.compressed <= 4096);
  check("croissant widget has no size row", !plainHtml.includes("id=bS"));

  const order = createOrder({
    user: { id: 4242, first_name: "Test" },
    lines: [{ id: "macchiato", name: "Ethiopian Macchiato", qty: 2, unitPrice: 80, options: {} }],
    fulfillment: "pickup",
    paymentMethod: "telebirr",
  });
  const orderHtml = buildOrderWidget(order);
  const orderSizes = widgetSizes(orderHtml);
  console.log(`order widget (${order.id}): raw=${orderSizes.raw} compressed=${orderSizes.compressed}`);
  check("order widget raw <= 32768", orderSizes.raw <= 32768);
  check("order widget compressed <= 4096", orderSizes.compressed <= 4096);
  check("order widget mentions order id", orderHtml.includes(order.id));

  // --- 2. No external content in widgets (sandbox has no network) ---
  for (const [name, html] of [["item", itemHtml], ["order", orderHtml]] as const) {
    check(`${name} widget has no http(s) URLs`, !/https?:\/\//.test(html));
    check(`${name} widget has no <img`, !/<img/i.test(html));
    check(`${name} widget has no fetch/WebSocket`, !/fetch\s*\(|WebSocket/.test(html));
  }

  // --- 3. No-token sends fail gracefully, never throw ---
  const noToken = await sendItemWidget(4242, "macchiato");
  check("sendItemWidget without token -> ok:false, no throw", noToken.ok === false);

  // --- 4. Simulated widget queries (offline, no token) ---
  const base: Omit<WidgetQuery, "data"> = {
    id: "q-test",
    from: { id: 4242, first_name: "Test" },
    chat: { id: 4242, type: "private" },
    message_id: 99,
  };
  check("isWidgetQuery detects widget_query", isWidgetQuery({ widget_query: { ...base, data: "add:macchiato:M" } }));
  check("isWidgetQuery rejects plain message", !isWidgetQuery({ message: { text: "hi" } }));

  const checkoutEmpty = await handleWidgetQuery({ ...base, id: "q0", data: "checkout" });
  check("checkout with empty cart handled", checkoutEmpty.action === "checkout" && checkoutEmpty.ok === false);

  const sizeRes = await handleWidgetQuery({ ...base, id: "q1", data: "size:macchiato:M" });
  check("size query handled", sizeRes.action === "size" && sizeRes.ok === true);

  const add1 = await handleWidgetQuery({ ...base, id: "q2", data: "add:macchiato:M" });
  const draftId = getWidgetDraftId(4242);
  const draft1 = draftId ? getDraft(draftId) : undefined;
  check("add query handled", add1.action === "add" && add1.ok === true);
  check("draft created with 1 line", !!draft1 && draft1.lines.length === 1);
  check("draft line is Medium macchiato, 110 ETB", !!draft1 && draft1.lines[0].qty === 1 && draft1.lines[0].unitPrice === 110 && draft1.lines[0].options?.Size === "Medium");

  const add2 = await handleWidgetQuery({ ...base, id: "q3", data: "add:macchiato:M" });
  const draft2 = draftId ? getDraft(draftId) : undefined;
  check("second add merges to qty 2", !!draft2 && draft2.lines[0].qty === 2);

  const checkout = await handleWidgetQuery({ ...base, id: "q4", data: "checkout" });
  check("checkout with draft handled (send fails w/o token, no throw)", checkout.action === "checkout");

  const refresh = await handleWidgetQuery({ ...base, id: "q5", data: `refresh:${order.id}` });
  check("refresh query handled", refresh.action === "refresh" && refresh.ok === true);

  const unknown = await handleWidgetQuery({ ...base, id: "q6", data: "nonsense" });
  check("unknown query answered, no throw", unknown.answered === true);

  const addCroissant = await handleWidgetQuery({ ...base, id: "q7", data: "add:croissant:S" });
  check("add works for stock item too", addCroissant.action === "add");

  console.log(failures === 0 ? "\nALL WIDGET CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
