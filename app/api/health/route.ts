import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true, service: "buna-corner", time: new Date().toISOString(),
    botConfigured: !!process.env.BOT_TOKEN,
    ownerConfigured: !!process.env.OWNER_TELEGRAM_ID,
  });
}
