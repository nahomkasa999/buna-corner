import { NextResponse } from "next/server";
import { getMenuWithStock } from "@/lib/store";

export async function GET() {
  return NextResponse.json({ ok: true, items: getMenuWithStock() });
}
