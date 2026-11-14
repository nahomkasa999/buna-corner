import { NextResponse } from "next/server";
import { getDraft } from "@/lib/store";

/** GET /api/drafts/[id] — a bot-checkout draft (lines prefilled into the Mini App cart). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = getDraft(decodeURIComponent(id));
  if (!draft) return NextResponse.json({ ok: false, error: "Draft not found" }, { status: 404 });
  return NextResponse.json({ ok: true, draft });
}
