import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      return NextResponse.json(
        { error: "伺服器資料庫設定錯誤" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject")?.trim() || "";

    if (!subject) {
      return NextResponse.json(
        { error: "缺少科目參數" },
        { status: 400 }
      );
    }

    const sql = neon(databaseUrl);

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    const userId = session?.user?.id ?? null;

    const questions = userId
      ? await sql`
          SELECT
            q.id,
            q.question_set_id,
            q.question_number,
            q.subject,
            q.question,
            q.option_a,
            q.option_b,
            q.option_c,
            q.option_d,
            q.answer,
            q.explanation
          FROM questions q
          INNER JOIN question_sets qs
            ON qs.id = q.question_set_id
          WHERE
            q.subject = ${subject}
            AND (
              qs.visibility = 'public'
              OR (
                qs.visibility = 'private'
                AND qs.owner_id = ${userId}
              )
            )
          ORDER BY
            qs.created_at ASC,
            q.question_number ASC
        `
      : await sql`
          SELECT
            q.id,
            q.question_set_id,
            q.question_number,
            q.subject,
            q.question,
            q.option_a,
            q.option_b,
            q.option_c,
            q.option_d,
            q.answer,
            q.explanation
          FROM questions q
          INNER JOIN question_sets qs
            ON qs.id = q.question_set_id
          WHERE
            q.subject = ${subject}
            AND qs.visibility = 'public'
          ORDER BY
            qs.created_at ASC,
            q.question_number ASC
        `;

    const formattedQuestions = questions.map((q: any) => ({
      id: Number(q.id),
      questionSetId: Number(q.question_set_id),
      questionNumber: Number(q.question_number),
      subject: q.subject ?? "",
      question: q.question ?? "",
      options: [
        q.option_a ?? "",
        q.option_b ?? "",
        q.option_c ?? "",
        q.option_d ?? "",
      ],
      answer: q.answer ?? "",
      explanation: q.explanation ?? "",
    }));

    return NextResponse.json({
      success: true,
      subject,
      totalQuestions: formattedQuestions.length,
      questions: formattedQuestions,
    });
  } catch (error) {
    console.error("Questions API error:", error);

    return NextResponse.json(
      {
        error: "取得題目失敗",
        detail:
          error instanceof Error
            ? error.message
            : "未知錯誤",
      },
      { status: 500 }
    );
  }
}