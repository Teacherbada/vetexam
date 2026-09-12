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
    // Public exam settings are isolated from the existing private quiz behavior.
    if (searchParams.get("scope") === "public") {
      const sql = neon(databaseUrl);
      if (searchParams.get("settings") === "1") {
        const availability = await sql`
          SELECT q.subject, qs.exam_year AS year, COUNT(*)::int AS count
          FROM questions q JOIN question_sets qs ON qs.id = q.question_set_id
          WHERE qs.visibility = 'public'
          GROUP BY q.subject, qs.exam_year ORDER BY qs.exam_year DESC NULLS LAST
        `;
        return NextResponse.json({ availability });
      }
      let groups: unknown;
      try { groups = JSON.parse(searchParams.get("groups") || "[]"); }
      catch { return NextResponse.json({ error: "請確認測驗設定格式" }, { status: 400 }); }
      if (!Array.isArray(groups) || !groups.length || groups.length > 6 || groups.some((g) =>
        !g || typeof g.subject !== "string" || !g.subject.trim() ||
        !Array.isArray(g.years) || !g.years.every(Number.isInteger) ||
        (g.count !== "all" && (!Number.isInteger(Number(g.count)) || Number(g.count) < 1)))) {
        return NextResponse.json({ error: "請確認科目、年份與題數設定" }, { status: 400 });
      }
      const random = searchParams.get("order") === "random";
      const batches = await Promise.all(groups.map(async (group) => {
        const yearFilter = group.years.length ? sql`qs.exam_year = ANY(${group.years})` : sql`TRUE`;
        const ordering = random ? sql`RANDOM()` : sql`qs.exam_year ASC NULLS LAST, q.question_number ASC, q.question_set_id ASC, q.id ASC`;
        return sql`
          SELECT q.*, qs.exam_year, qs.name AS question_set_name
          FROM questions q JOIN question_sets qs ON qs.id = q.question_set_id
          WHERE qs.visibility = 'public' AND q.subject = ${group.subject} AND ${yearFilter}
          ORDER BY ${ordering} LIMIT ${group.count === "all" ? null : Number(group.count)}
        `;
      }));
      const unique = [...new Map(batches.flat().map((q) => [q.id, q])).values()];
      if (random) {
        for (let i = unique.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [unique[i], unique[j]] = [unique[j], unique[i]];
        }
      } else unique.sort((a, b) => (a.exam_year ?? Infinity) - (b.exam_year ?? Infinity) || a.question_number - b.question_number || a.question_set_id - b.question_set_id || a.id - b.id);
      return NextResponse.json({ questions: unique.map((q) => ({
        id: Number(q.id), questionSetId: Number(q.question_set_id), questionNumber: Number(q.question_number),
        subject: q.subject ?? "", question: q.question ?? "",
        options: [q.option_a ?? "", q.option_b ?? "", q.option_c ?? "", q.option_d ?? ""],
        answer: q.answer ?? "", explanation: q.explanation ?? "",
        examYear: q.exam_year == null ? null : Number(q.exam_year), questionSetName: q.question_set_name ?? "",
      })) });
    }
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
    const questionOrder = searchParams.get("order") === "random"
      ? sql`RANDOM()`
      : sql`qs.exam_year ASC NULLS LAST, qs.created_at ASC, q.question_number ASC`;

    const rows = await sql`
      SELECT q.id, q.question_set_id, q.question_number, q.subject, q.question,
             q.option_a, q.option_b, q.option_c, q.option_d, q.answer, q.explanation,
             qs.exam_year, qs.name AS question_set_name
      FROM questions q
      INNER JOIN question_sets qs ON qs.id = q.question_set_id
      WHERE ${visibility} AND ${subjectFilter} AND ${yearFilter}
      ORDER BY ${questionOrder}
      LIMIT ${count}
    `;

    return NextResponse.json({
      success: true,
      totalQuestions: rows.length,
      questions: rows.map((q) => ({
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
