import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { optionDistribution } from "@/lib/question-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rawId = new URL(request.url).searchParams.get("questionId");
  const questionId = Number(rawId);
  if (!rawId || !/^[1-9]\d*$/.test(rawId) || !Number.isInteger(questionId) || questionId > 2147483647) {
    return NextResponse.json({ error: "題目編號錯誤" }, { status: 400 });
  }
  try {
    if (!process.env.DATABASE_URL) throw new Error("Missing database configuration");
    const sql = neon(process.env.DATABASE_URL);
    const result = await optionDistribution((text, values) => sql.query(text, values), questionId);
    if (!result) return NextResponse.json({ error: "找不到公開題目" }, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("Option distribution read failed");
    return NextResponse.json({ error: "暫時無法取得作答分布。" }, { status: 503 });
  }
}
