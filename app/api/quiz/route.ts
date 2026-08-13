import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseList(value: string | null) {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export async function GET(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return NextResponse.json({ error: "伺服器資料庫設定錯誤" }, { status: 500 });

    const { searchParams } = new URL(request.url);
    const subjects = parseList(searchParams.get("subjects"));
    const years = parseList(searchParams.get("years")).map(Number).filter(Number.isInteger);
    const requestedCount = Number(searchParams.get("count") || 0);
    const count = Number.isInteger(requestedCount) && requestedCount > 0 ? Math.min(requestedCount, 500) : 500;

    if (subjects.length === 0 && years.length === 0) {
      return NextResponse.json({ error: "至少需要選擇一個科目或年份" }, { status: 400 });
    }

    const sql = neon(databaseUrl);
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id ?? null;

    const visibility = userId
      ? sql`(qs.visibility = 'public' OR (qs.visibility = 'private' AND qs.owner_id = ${userId}))`
      : sql`qs.visibility = 'public'`;
    const subjectFilter = subjects.length ? sql`q.subject = ANY(${subjects})` : sql`TRUE`;
    const yearFilter = years.length ? sql`qs.exam_year = ANY(${years})` : sql`TRUE`;

    const rows = await sql`
      SELECT q.id, q.question_set_id, q.question_number, q.subject, q.question,
             q.option_a, q.option_b, q.option_c, q.option_d, q.answer, q.explanation,
             qs.exam_year, qs.name AS question_set_name
      FROM questions q
      INNER JOIN question_sets qs ON qs.id = q.question_set_id
      WHERE ${visibility} AND ${subjectFilter} AND ${yearFilter}
      ORDER BY qs.exam_year ASC NULLS LAST, qs.created_at ASC, q.question_number ASC
      LIMIT ${count}
    `;

    return NextResponse.json({
      success: true,
      totalQuestions: rows.length,
      questions: rows.map((q: any) => ({
        id: Number(q.id),
        questionSetId: Number(q.question_set_id),
        questionNumber: Number(q.question_number),
        subject: q.subject ?? "",
        question: q.question ?? "",
        options: [q.option_a ?? "", q.option_b ?? "", q.option_c ?? "", q.option_d ?? ""],
        answer: q.answer ?? "",
        explanation: q.explanation ?? "",
        examYear: q.exam_year == null ? null : Number(q.exam_year),
        questionSetName: q.question_set_name ?? "",
      })),
    });
  } catch (error) {
    console.error("Quiz API error:", error);
    return NextResponse.json({ error: "取得測驗題目失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}
