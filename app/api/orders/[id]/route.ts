import { NextResponse } from "next/server";
import { getOrder, updateOrderStatus, type OrderStatus } from "@/lib/store";
import { isOwnerRequest, resolveUser } from "@/lib/telegram-auth";
import { notifyOrderStatus } from "@/bot/bot";

const STATUSES: OrderStatus[] = ["Received", "Brewing", "Ready", "Out for delivery", "Completed", "Cancelled"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = getOrder(id);
  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  return NextResponse.json({ ok: true, order });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = resolveUser(req);
  if (!isOwnerRequest(req, user)) {
    return NextResponse.json({ ok: false, error: "Owner only" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const status = String(body.status ?? "");
  if (!STATUSES.includes(status as OrderStatus)) {
    return NextResponse.json({ ok: false, error: `Invalid status. Use one of: ${STATUSES.join(", ")}` }, { status: 400 });
  }
  const order = updateOrderStatus(id, status as OrderStatus);
  if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
  notifyOrderStatus(id).catch(() => undefined);
  return NextResponse.json({ ok: true, order });
}
