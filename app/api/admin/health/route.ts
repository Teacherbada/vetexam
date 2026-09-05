import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "沒有管理員權限。" }, { status: 403 });
    const rows = await admin.sql`
      WITH recent AS (
        SELECT id, event_code, error_kind, created_at FROM system_errors
        WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
      ), latest AS (
        SELECT * FROM recent ORDER BY created_at DESC, id DESC LIMIT 20
      )
      SELECT CURRENT_TIMESTAMP AS checked_at,
        (SELECT count(*)::int FROM recent WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours') AS last_24_hours,
        (SELECT count(*)::int FROM recent) AS last_7_days,
        COALESCE((SELECT json_agg(json_build_object(
          'id', id::text, 'event_code', event_code, 'error_kind', error_kind, 'created_at', created_at
        ) ORDER BY created_at DESC, id DESC) FROM latest), '[]'::json) AS errors
    `;
    return NextResponse.json(rows[0], { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Health read failures must not create new error records on every refresh.
    console.error("System health read unavailable.");
    return NextResponse.json({ error: "無法讀取錯誤紀錄，目前狀態未知。" }, { status: 503 });
  }
}
