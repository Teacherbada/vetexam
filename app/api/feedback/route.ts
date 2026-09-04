import { NextResponse } from "next/server";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureFeedbackTable(sql: NeonQueryFunction<false, false>) {
  await sql`CREATE TABLE IF NOT EXISTS feedback_reports (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_email TEXT,
    category TEXT NOT NULL CHECK (category IN ('bug', 'suggestion')),
    message TEXT NOT NULL,
    context TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return NextResponse.json({ error: "請先登入後再送出回報。" }, { status: 401 });
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return NextResponse.json({ error: "資料庫尚未設定。" }, { status: 500 });

    const body = await request.json();
    const category = body?.category === "suggestion" ? "suggestion" : body?.category === "bug" ? "bug" : null;
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const context = typeof body?.context === "string" ? body.context.trim().slice(0, 500) : "";
    if (!category) return NextResponse.json({ error: "請選擇回報類型。" }, { status: 400 });
    if (message.length < 5 || message.length > 2000) return NextResponse.json({ error: "回報內容需介於 5 至 2000 字。" }, { status: 400 });

    const sql = neon(databaseUrl);
    await ensureFeedbackTable(sql);
    await sql`INSERT INTO feedback_reports (user_id, user_email, category, message, context)
      VALUES (${session.user.id}, ${session.user.email ?? null}, ${category}, ${message}, ${context || null})`;
    return NextResponse.json({ success: true, message: "已收到你的回報，謝謝你幫助 VetExam 改進。" });
  } catch (error) {
    console.error("Create feedback error:", error);
    return NextResponse.json({ error: "送出回報失敗。" }, { status: 500 });
  }
}
