import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "沒有管理員權限。" }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "all";
    const category = params.get("category") ?? "all";
    const page = Number(params.get("page") ?? "1");
    if (!["all", "open", "resolved"].includes(status) || !["all", "bug", "suggestion"].includes(category) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) {
      return NextResponse.json({ error: "篩選條件無效。" }, { status: 400 });
    }
    const rows = await admin.sql`
      WITH filtered AS (
        SELECT id::text, user_id, user_email, category, message, context, status, created_at, updated_at
        FROM feedback_reports WHERE (${status}='all' OR status=${status}) AND (${category}='all' OR category=${category})
      ), paged AS (SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ${(page - 1) * 20})
      SELECT (SELECT count(*)::int FROM filtered) AS total,
        COALESCE((SELECT json_agg(paged ORDER BY created_at DESC, id DESC) FROM paged), '[]'::json) AS reports
    `;
    return NextResponse.json({ ...rows[0], pageSize: 20 });
  } catch (error) {
    console.error("List reports error:", error);
    return NextResponse.json({ error: "讀取回報失敗。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "沒有管理員權限。" }, { status: 403 });
    const body = await request.json().catch(() => null);
    const id = String(body?.id ?? "");
    const status = body?.status;
    if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > BigInt("9223372036854775807") || !["open", "resolved"].includes(status)) {
      return NextResponse.json({ error: "回報資料無效。" }, { status: 400 });
    }
    const rows = await admin.sql`UPDATE feedback_reports SET status=${status}, updated_at=CURRENT_TIMESTAMP WHERE id=${id} RETURNING id::text, status, updated_at`;
    if (!rows.length) return NextResponse.json({ error: "找不到回報。" }, { status: 404 });
    return NextResponse.json({ report: rows[0] });
  } catch (error) {
    console.error("Update reports error:", error);
    return NextResponse.json({ error: "更新回報失敗。" }, { status: 500 });
  }
}
