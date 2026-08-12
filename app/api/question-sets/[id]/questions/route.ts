import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: Request,
  context: RouteContext
) {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      console.error("Questions API: DATABASE_URL not found");

      return NextResponse.json(
        {
          error: "伺服器資料庫設定錯誤",
        },
        { status: 500 }
      );
    }

    const { id } = await context.params;

    const questionSetId = Number(id);

    if (!Number.isInteger(questionSetId) || questionSetId <= 0) {
      return NextResponse.json(
        {
          error: "無效的題庫 ID",
        },
        { status: 400 }
      );
    }

    const sql = neon(databaseUrl);

    /*
     * 取得目前登入狀態。
     *
     * public 題庫不需要登入。
     * private 題庫則必須是 owner。
     */
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    const userId = session?.user?.id ?? null;

    /*
     * 第一步：
     * 先確認題庫是否存在，以及它的 visibility / owner_id。
     */
    const questionSets = await sql`
      SELECT
        id,
        name,
        filename,
        total_questions,
        created_at,
        file_hash,
        visibility,
        owner_id
      FROM question_sets
      WHERE id = ${questionSetId}
      LIMIT 1
    `;

    if (questionSets.length === 0) {
      return NextResponse.json(
        {
          error: "找不到這個題庫",
        },
        { status: 404 }
      );
    }

    const questionSet = questionSets[0];

    /*
     * 第二步：
     * 檢查題庫權限。
     *
     * public：
     * 所有人都可以刷。
     *
     * private：
     * 必須登入，而且必須是建立者本人。
     */
    if (questionSet.visibility === "private") {
      if (!userId) {
        return NextResponse.json(
          {
            error: "這是私人題庫，請先登入。",
            code: "LOGIN_REQUIRED",
          },
          { status: 401 }
        );
      }

      if (questionSet.owner_id !== userId) {
        return NextResponse.json(
          {
            error: "你沒有權限使用這個私人題庫。",
            code: "FORBIDDEN",
          },
          { status: 403 }
        );
      }
    }

    /*
     * 第三步：
     * 通過權限檢查後，才取得題目。
     */
    const questions = await sql`
      SELECT
        id,
        question_set_id,
        question_number,
        subject,
        question,
        option_a,
        option_b,
        option_c,
        option_d,
        answer,
        explanation,
        created_at
      FROM questions
      WHERE question_set_id = ${questionSetId}
      ORDER BY question_number ASC
    `;

    /*
     * 轉成前端刷題頁目前使用的格式。
     */
    const formattedQuestions = questions.map((question: any) => ({
      id: Number(question.id),
      questionNumber: Number(question.question_number),
      subject: question.subject ?? "",
      question: question.question ?? "",
      options: [
        question.option_a ?? "",
        question.option_b ?? "",
        question.option_c ?? "",
        question.option_d ?? "",
      ],
      answer: question.answer ?? "",
      explanation: question.explanation ?? "",
    }));

    return NextResponse.json({
      success: true,
      questionSet: {
        id: Number(questionSet.id),
        name: questionSet.name,
        filename: questionSet.filename,
        totalQuestions: Number(questionSet.total_questions),
        visibility: questionSet.visibility,
        ownerId: questionSet.owner_id,
      },
      questions: formattedQuestions,
    });
  } catch (error) {
    console.error("Questions API error:", error);

    return NextResponse.json(
      {
        error: "無法取得題目",
        detail:
          error instanceof Error
            ? error.message
            : "未知錯誤",
      },
      { status: 500 }
    );
  }
}