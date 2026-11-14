// Seed script for the real Prisma DB (see prisma/schema.prisma).
// Usage: npx prisma db push && npx tsx prisma/seed.ts
// The demo runtime does NOT use this — it seeds from lib/data.ts in-memory.
import { PrismaClient } from "@prisma/client";
import { MENU_ITEMS } from "../lib/data";

const prisma = new PrismaClient();

async function main() {
  for (const item of MENU_ITEMS) {
    await prisma.menuItem.upsert({
      where: { id: item.id },
      update: { ...item, options: JSON.stringify(item.options ?? []) },
      create: { ...item, options: JSON.stringify(item.options ?? []) },
    });
  }
  console.log(`Seeded ${MENU_ITEMS.length} menu items.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
