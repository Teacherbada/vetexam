import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";
import { validChapter } from "@/data/exam-chapters";
import { QUESTION_STATES, stateSelection, type QuestionState } from '@/lib/question-state';
import { questionTransaction } from '@/lib/question-transaction';
import { readQuestionState } from '@/lib/learning-service';
import { readPublicAvailability } from '@/lib/home-public-data';

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
        const { availability, chapterAvailability } = await readPublicAvailability();
        if (searchParams.get("chapters") === "1") {
          return NextResponse.json({ availability, chapterAvailability });
        }
        return NextResponse.json({ availability });
      }
      let groups: unknown;
      try { groups = JSON.parse(searchParams.get("groups") || "[]"); }
      catch { return NextResponse.json({ error: "請確認測驗設定格式" }, { status: 400 }); }
      const questionId = searchParams.has("questionId") ? Number(searchParams.get("questionId")) : null;
      if (questionId !== null) {
        if (!Number.isInteger(questionId) || questionId < 1 || questionId > 2147483647) {
          return NextResponse.json({ error: "題目編號錯誤" }, { status: 400 });
        }
        // A leaderboard link starts one public question through the existing quiz.
        groups = [{ subject: "single-question", years: [], count: "1" }];
      }
      if (!Array.isArray(groups) || !groups.length || groups.length > 6 || groups.some((g) =>
        !g || typeof g.subject !== "string" || !g.subject.trim() ||
        !validChapter(g.subject, g.chapter) ||
        !Array.isArray(g.years) || !g.years.every(Number.isInteger) ||
        (g.count !== "all" && (!Number.isInteger(Number(g.count)) || Number(g.count) < 1)))) {
        return NextResponse.json({ error: "請確認科目、章節、年份與題數設定" }, { status: 400 });
      }
      const random = searchParams.get("order") === "random";
      const state = searchParams.get('state') ?? 'all';
      if (!QUESTION_STATES.includes(state as QuestionState)) return NextResponse.json({ error: '題目狀態無效' }, { status: 400 });
      let selection: ReturnType<typeof stateSelection> = null;
      if (state !== 'all') {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user.id) return NextResponse.json({ error: '請登入使用帳號題目篩選，或選擇全部題目。' }, { status: 401 });
        selection = stateSelection(state as QuestionState, await questionTransaction(client => readQuestionState(client, session.user.id)));
      }
      const stateFilter = !selection ? sql`TRUE` : selection.exclude ? sql`NOT (q.id = ANY(${selection.ids}::integer[]))` : sql`q.id = ANY(${selection.ids}::integer[])`;
      const batches = await Promise.all(groups.map(async (group) => {
        const yearFilter = group.years.length ? sql`qs.exam_year = ANY(${group.years})` : sql`TRUE`;
        const subjectFilter = questionId === null ? sql`q.subject = ${group.subject}` : sql`q.id = ${questionId}`;
        const chapterFilter = group.chapter ? sql`q.chapter = ${group.chapter}` : sql`TRUE`;
        const ordering = random ? sql`RANDOM()` : sql`qs.exam_year ASC NULLS LAST, q.question_number ASC, q.question_set_id ASC, q.id ASC`;
        return sql`
          SELECT q.*, qs.exam_year, qs.name AS question_set_name
          FROM questions q JOIN question_sets qs ON qs.id = q.question_set_id
          WHERE qs.visibility = 'public' AND ${subjectFilter} AND ${yearFilter} AND ${chapterFilter} AND ${stateFilter}
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
        options: [q.option_a ?? "", q.option_b ?? "", q.option_c ?? "", q.option_d ?? "", ...(questionId !== null && q.option_e?.trim() ? [q.option_e] : [])],
        answer: q.answer ?? "", explanation: q.explanation ?? "",
        imageDataUrl: q.image_data_url ?? null,
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
             q.option_a, q.option_b, q.option_c, q.option_d, q.answer, q.explanation, q.image_data_url,
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
        imageDataUrl: q.image_data_url ?? null,
        examYear: q.exam_year == null ? null : Number(q.exam_year),
        questionSetName: q.question_set_name ?? "",
      })),
    });
  } catch (error) {
    console.error("Quiz API error:", error);
    return NextResponse.json({ error: "取得測驗題目失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}
