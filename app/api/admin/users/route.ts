import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { recordSystemError } from "@/lib/system-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "沒有管理員權限。" }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const email = (params.get("email") ?? "").trim();
    const plan = params.get("plan") ?? "all";
    const page = Number(params.get("page") ?? "1");
    if (email.length > 254 || !["all", "free", "pro"].includes(plan) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) {
      return NextResponse.json({ error: "搜尋條件無效。" }, { status: 400 });
    }
    const rows = await admin.sql`
      WITH members AS (
        SELECT u.id, u.name, u.email, u."createdAt" AS created_at,
          s.plan, s.status, s.expires_at,
          CASE WHEN s.plan='pro' AND s.status='active'
            AND (s.expires_at IS NULL OR s.expires_at > CURRENT_TIMESTAMP)
            THEN 'pro' ELSE 'free' END AS effective_plan
        FROM "user" u LEFT JOIN subscriptions s ON s.user_id=u.id
      ), filtered AS (
        SELECT * FROM members WHERE strpos(lower(email), lower(${email})) > 0
          AND (${plan}='all' OR effective_plan=${plan})
      ), paged AS (
        SELECT f.*, (SELECT count(*)::int FROM question_sets q WHERE q.owner_id=f.id) AS bank_count
        FROM filtered f ORDER BY created_at DESC, id LIMIT 20 OFFSET ${(page - 1) * 20}
      )
      SELECT (SELECT count(*)::int FROM filtered) AS total,
        COALESCE((SELECT json_agg(paged ORDER BY created_at DESC, id) FROM paged), '[]'::json) AS users
    `;
    return NextResponse.json({ ...rows[0], page, pageSize: 20 });
  } catch (error) {
    console.error("Admin users error:", error);
    await recordSystemError("admin_users_read", error);
    return NextResponse.json({ error: "讀取會員失敗。" }, { status: 500 });
  }
}
