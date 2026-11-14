import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai";

export async function GET() {
  return NextResponse.json({
    ok: true,
    aiConfigured: aiConfigured(),
    ttsConfigured: aiConfigured(),
    mock: !aiConfigured(),
  });
}
