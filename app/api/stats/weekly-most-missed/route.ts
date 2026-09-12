import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { MIN_ATTEMPTS, weeklyMostMissed } from "@/lib/question-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) throw new Error("Missing database configuration");
    const sql = neon(process.env.DATABASE_URL);
    const questions = await weeklyMostMissed((text, values) => sql.query(text, values));
    return NextResponse.json({ question: questions[0] ?? null, min_attempts: MIN_ATTEMPTS });
  } catch {
    console.error("Weekly most-missed statistics read failed");
    return NextResponse.json({ error: "本週錯題暫時無法載入" }, { status: 503 });
  }
}
