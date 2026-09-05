import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { recordSystemError } from "@/lib/system-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const [users, banks, questions, plans, reports, dailyUsers, subjects, years] = await Promise.all([
      admin.sql`SELECT count(*)::int total, count(*) FILTER (WHERE "createdAt">=CURRENT_DATE)::int today, count(*) FILTER (WHERE "createdAt">=CURRENT_DATE-INTERVAL '7 days')::int week FROM "user"`,
      admin.sql`SELECT count(*)::int total,count(*) FILTER(WHERE visibility='public')::int public,count(*) FILTER(WHERE visibility='private')::int private FROM question_sets`,
      admin.sql`SELECT count(*)::int total FROM questions`,
      admin.sql`SELECT plan,status,count(*)::int count FROM subscriptions GROUP BY plan,status ORDER BY plan,status`,
      admin.sql`SELECT status,count(*)::int count FROM feedback_reports GROUP BY status ORDER BY status`,
      admin.sql`SELECT to_char(days.day,'MM/DD') AS date,count("user".id)::int AS count FROM generate_series(CURRENT_DATE-INTERVAL '13 days',CURRENT_DATE,INTERVAL '1 day') AS days(day) LEFT JOIN "user" ON "user"."createdAt">=days.day AND "user"."createdAt"<days.day+INTERVAL '1 day' GROUP BY days.day ORDER BY days.day`,
      admin.sql`SELECT COALESCE(NULLIF(trim(exam_subject), ''), '未分類') AS label, count(*)::int count FROM question_sets GROUP BY 1 ORDER BY count DESC, label`,
      admin.sql`SELECT COALESCE(exam_year::text, '未設定') AS label, count(*)::int count FROM question_sets GROUP BY 1 ORDER BY label DESC`
    ]);
    return NextResponse.json({ users: users[0], banks: banks[0], questions: questions[0], plans, reports, dailyUsers, subjects, years, activityTracked: false, pdfTracking: false, errorTracking: "admin-apis-only" });
  } catch (error) {
    console.error("Dashboard error:", error);
    await recordSystemError("admin_dashboard_read", error);
    return NextResponse.json({ error: "Dashboard unavailable" }, { status: 500 });
  }
}
