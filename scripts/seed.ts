// Prints the seed menu (demo runtime seeds in-memory from lib/data.ts).
import { MENU_ITEMS, CATEGORIES } from "../lib/data";

console.log("Buna Corner — seed menu");
console.log(`Categories: ${CATEGORIES.join(", ")}`);
for (const item of MENU_ITEMS) {
  console.log(`- ${item.id.padEnd(20)} ${item.name.padEnd(38)} ${item.price} ETB  [${item.category}]${item.popular ? " ★" : ""}${item.soldOut ? " SOLD OUT" : ""}`);
}
console.log(`Total: ${MENU_ITEMS.length} items`);
