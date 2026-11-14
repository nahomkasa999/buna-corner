import { NextResponse } from "next/server";
import { getMenuItem } from "@/lib/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = getMenuItem(id);
  if (!item) return NextResponse.json({ ok: false, error: "Item not found" }, { status: 404 });
  return NextResponse.json({ ok: true, item });
}
