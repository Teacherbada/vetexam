import { NextResponse } from "next/server";
import { readWeeklyChallenge } from '@/lib/home-public-data';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await readWeeklyChallenge());
  } catch {
    console.error("Weekly most-missed statistics read failed");
    return NextResponse.json({ error: "本週錯題暫時無法載入" }, { status: 503 });
  }
}
