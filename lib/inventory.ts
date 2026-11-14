// Inventory seed — realistic starting stock for the demo shop.
// Drinks/tea are counted in cups per day, food in portions, beans in 250 g bags.
// lowAt is the threshold that triggers a "low stock" alert to the owner.
// NOTE: in-memory only for the demo — resets on every redeploy/restart,
// same as the rest of lib/store.ts. See LIMITATIONS.md.

export interface StockSeed {
  qty: number;
  unit: string;
  lowAt: number;
}

export const SEED_STOCK: Record<string, StockSeed> = {
  // Coffee — cups per day
  macchiato: { qty: 40, unit: "cups", lowAt: 5 },
  "jebena-buna": { qty: 30, unit: "cups", lowAt: 5 },
  espresso: { qty: 50, unit: "cups", lowAt: 5 },
  cappuccino: { qty: 35, unit: "cups", lowAt: 5 },
  "cafe-latte": { qty: 35, unit: "cups", lowAt: 5 },
  "cold-brew": { qty: 20, unit: "cups", lowAt: 5 },
  "hot-chocolate": { qty: 25, unit: "cups", lowAt: 5 },
  // Tea — cups per day
  shai: { qty: 40, unit: "cups", lowAt: 5 },
  "green-tea": { qty: 30, unit: "cups", lowAt: 5 },
  // Food — portions
  "avocado-smoothie": { qty: 15, unit: "portions", lowAt: 5 },
  sambusa: { qty: 30, unit: "portions", lowAt: 5 },
  ful: { qty: 20, unit: "portions", lowAt: 5 },
  croissant: { qty: 25, unit: "portions", lowAt: 5 },
  // Beans — 250 g bags
  "yirgacheffe-beans": { qty: 12, unit: "bags", lowAt: 3 },
  "sidamo-beans": { qty: 10, unit: "bags", lowAt: 3 },
};
