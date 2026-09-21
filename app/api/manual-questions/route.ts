import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";
import { hasProAccess } from "@/lib/subscription";
import { EXAM_SUBJECTS } from '@/data/exam-chapters';
import { validImportChapters } from '@/lib/chapter-classification';

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
  chapter: string | null;
};

export async function POST(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      return NextResponse.json(
        {
          error: "伺服器資料庫設定錯誤",
        },
        { status: 500 }
      );
    }

    /*
     * 檢查登入狀態
     */
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "請先登入才能手動匯入題目。",
        },
        { status: 401 }
      );
    }

    const userId = session.user.id;

    const sql = neon(databaseUrl);

    /*
     * 檢查 PRO
     */
    const isAdmin = userId === process.env.ADMIN_USER_ID?.trim();
    const isPro = isAdmin || await hasProAccess(request.headers);

    if (!isPro) {
      return NextResponse.json(
        {
          error: "目前只有 PRO 會員可以匯入題目。",
          code: "PRO_REQUIRED",
        },
        { status: 403 }
      );
    }

    const body = await request.json();

    const {
      name,
      questions,
    } = body;

    const finalVisibility = body.visibility === 'public' && isAdmin ? 'public' : 'private';
    if (body.visibility === 'public' && !isAdmin) return NextResponse.json({ error: '只有管理員可以建立公開國考題庫。' }, { status: 403 });
    const examSubject = typeof body.examSubject === 'string' ? body.examSubject : '';
    if (examSubject && !EXAM_SUBJECTS.includes(examSubject)) return NextResponse.json({ error: '請選擇官方國考科目。' }, { status: 400 });
    const examYear = body.examYear == null ? null : Number(body.examYear);
    if (examYear !== null && (!Number.isInteger(examYear) || examYear < 1990 || examYear > 2100)) return NextResponse.json({ error: '國考年份無效。' }, { status: 400 });

    if (!Array.isArray(questions)) {
      return NextResponse.json(
        {
          error: "題目資料格式錯誤。",
        },
        { status: 400 }
      );
    }

    if (questions.length === 0) {
      return NextResponse.json(
        {
          error: "至少需要一題。",
        },
        { status: 400 }
      );
    }

    if (questions.length > 500) {
      return NextResponse.json(
        {
          error: "單次最多匯入 500 題。",
        },
        { status: 400 }
      );
    }

    if (!validImportChapters(examSubject, questions)) return NextResponse.json({ error: '章節不屬於該科官方章節清單。' }, { status: 400 });

    /*
     * 驗證每一題
     */
    const cleanedQuestions: ManualQuestion[] = [];

    for (let i = 0; i < questions.length; i++) {
      const item = questions[i];

      if (!item || typeof item !== "object") {
        return NextResponse.json(
          {
            error: `第 ${i + 1} 題資料格式錯誤。`,
          },
          { status: 400 }
        );
      }

      const question =
        typeof item.question === "string"
          ? item.question.trim()
          : "";

      const options = Array.isArray(item.options)
        ? item.options
            .slice(0, 4)
            .map((option: unknown) =>
              typeof option === "string"
                ? option.trim()
                : ""
            )
        : [];

      while (options.length < 4) {
        options.push("");
      }

      const answer =
        typeof item.answer === "string"
          ? item.answer.trim().toUpperCase()
          : "";

      const explanation =
        typeof item.explanation === "string"
          ? item.explanation.trim()
          : "";

      if (!question) {
        return NextResponse.json(
          {
            error: `第 ${i + 1} 題沒有題目內容。`,
          },
          { status: 400 }
        );
      }

      const filledOptions: string[] = options.filter(
  (option: string) => option !== ""
);

      if (filledOptions.length < 2) {
        return NextResponse.json(
          {
            error: `第 ${i + 1} 題至少需要兩個選項。`,
          },
          { status: 400 }
        );
      }

      if (
        answer &&
        !["A", "B", "C", "D"].includes(answer)
      ) {
        return NextResponse.json(
          {
            error: `第 ${i + 1} 題答案必須是 A、B、C 或 D。`,
          },
          { status: 400 }
        );
      }

      if (
        answer &&
        !options[
          "ABCD".indexOf(answer)
        ]
      ) {
        return NextResponse.json(
          {
            error: `第 ${i + 1} 題的答案 ${answer} 沒有對應的選項。`,
          },
          { status: 400 }
        );
      }

      cleanedQuestions.push({
        question,
        options,
        answer,
        explanation,
        chapter: item.chapter || null,
      });
    }

    /*
     * 建立題庫名稱
     */
    const cleanName =
      typeof name === "string" &&
      name.trim()
        ? name.trim()
        : "私人手動題庫";

    /*
     * 建立 question_sets
     */
    const insertedSets = await sql`
      INSERT INTO question_sets (
        name,
        filename,
        total_questions,
        visibility,
        owner_id,
        exam_subject,
        exam_year
      )
      VALUES (
        ${cleanName},
        ${"手動匯入"},
        ${cleanedQuestions.length},
        ${finalVisibility},
        ${userId},
        ${examSubject || null},
        ${examYear}
      )
      RETURNING
        id,
        name,
        visibility,
        owner_id,
        exam_subject,
        exam_year
    `;

    const questionSetId = Number(
      insertedSets[0].id
    );

    /*
     * 寫入題目
     */
    for (
      let index = 0;
      index < cleanedQuestions.length;
      index++
    ) {
      const question = cleanedQuestions[index];

      await sql`
        INSERT INTO questions (
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
          chapter
        )
        VALUES (
          ${questionSetId},
          ${index + 1},
          ${examSubject || "手動題庫"},
          ${question.question},
          ${question.options[0] ?? ""},
          ${question.options[1] ?? ""},
          ${question.options[2] ?? ""},
          ${question.options[3] ?? ""},
          ${question.answer},
          ${question.explanation},
          ${question.chapter}
        )
      `;
    }

    return NextResponse.json({
      success: true,
      message: `成功匯入 ${cleanedQuestions.length} 題。`,
      questionSetId,
      total: cleanedQuestions.length,
      visibility: finalVisibility,
      examSubject: examSubject || null,
      examYear,
    });
  } catch (error) {
    console.error(
      "Manual question import error:",
      error
    );

    return NextResponse.json(
      {
        error: "手動匯入題目失敗",
        detail:
          error instanceof Error
            ? error.message
            : "未知錯誤",
      },
      { status: 500 }
    );
  }
}
