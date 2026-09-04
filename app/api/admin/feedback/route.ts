import { NextResponse } from "next/server";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getAdminSql(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id || session.user.id !== process.env.ADMIN_USER_ID?.trim()) return null;
  const databaseUrl = process.env.DATABASE_URL;
  return databaseUrl ? neon(databaseUrl) : null;
}

async function ensureFeedbackTable(sql: NeonQueryFunction<false, false>) {
  await sql`CREATE TABLE IF NOT EXISTS feedback_reports (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, user_email TEXT, category TEXT NOT NULL CHECK (category IN ('bug', 'suggestion')), message TEXT NOT NULL, context TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
}

export async function GET(request: Request) {
  try {
    const sql = await getAdminSql(request);
    if (!sql) return NextResponse.json({ error: "沒有管理員權限。" }, { status: 403 });
    await ensureFeedbackTable(sql);
    const reports = await sql`SELECT id, user_id, user_email, category, message, context, status, created_at, updated_at FROM feedback_reports ORDER BY status ASC, created_at DESC`;
    return NextResponse.json({ reports });
  } catch (error) {
    console.error("List feedback error:", error);
    return NextResponse.json({ error: "讀取回報失敗。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const sql = await getAdminSql(request);
    if (!sql) return NextResponse.json({ error: "沒有管理員權限。" }, { status: 403 });
    const body = await request.json();
    const id = Number(body?.id);
    const status = body?.status === "resolved" ? "resolved" : body?.status === "open" ? "open" : null;
    if (!Number.isInteger(id) || id < 1 || !status) return NextResponse.json({ error: "回報資料無效。" }, { status: 400 });
    await ensureFeedbackTable(sql);
    await sql`UPDATE feedback_reports SET status=${status}, updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update feedback error:", error);
    return NextResponse.json({ error: "更新回報失敗。" }, { status: 500 });
  }
}
