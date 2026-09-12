import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { MIN_ATTEMPTS, mostMissed } from "@/lib/question-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const range = params.get("range") || "7d";
  const subject = params.get("subject")?.trim() || null;
  const year = params.has("year") ? Number(params.get("year")) : null;
  if (!["all", "7d"].includes(range) || (subject && subject.length > 100) ||
    (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))) {
    return NextResponse.json({ error: "請確認排行榜篩選條件" }, { status: 400 });
  }
  try {
    if (!process.env.DATABASE_URL) throw new Error("Missing database configuration");
    const sql = neon(process.env.DATABASE_URL);
    const questions = await mostMissed((text, values) => sql.query(text, values), range as "all" | "7d", subject, year);
    return NextResponse.json({ questions, min_attempts: MIN_ATTEMPTS, range });
  } catch {
    console.error("Most-missed statistics read failed");
    return NextResponse.json({ error: "排行榜暫時無法載入，請稍後再試。" }, { status: 503 });
  }
}
