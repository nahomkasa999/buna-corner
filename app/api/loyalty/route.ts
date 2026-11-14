import { NextResponse } from "next/server";
import { getLoyalty, getOrders, getReferrals } from "@/lib/store";
import { resolveUser } from "@/lib/telegram-auth";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const { user } = resolveUser(req);
  const userId = Number(url.searchParams.get("userId") ?? user.id);
  const loyalty = getLoyalty(userId);
  return NextResponse.json({
    ok: true,
    userId,
    stamps: loyalty.stamps,
    stampsToFree: 8 - loyalty.stamps,
    freeDrinksEarned: loyalty.freeDrinksEarned,
    totalOrders: loyalty.totalOrders,
    referrals: getReferrals(userId),
    history: getOrders(userId),
  });
}
