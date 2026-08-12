import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Visibility = "public" | "private";

type ManualQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
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
    const subscriptions = await sql`
      SELECT
        plan,
        status,
        expires_at
      FROM subscriptions
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    const subscription = subscriptions[0];

    const isPro =
      subscription?.plan === "pro" &&
      subscription?.status === "active" &&
      (
        subscription?.expires_at === null ||
        subscription?.expires_at === undefined ||
        new Date(subscription.expires_at) > new Date()
      );

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
      visibility,
      examSubject,
      examYear,
      questions,
    } = body;

    const finalVisibility: Visibility =
      visibility === "public"
        ? "public"
        : "private";

    /*
     * 公開國考題庫一定要有科目與年份
     */
    if (finalVisibility === "public") {
      if (!examSubject) {
        return NextResponse.json(
          {
            error: "公開國考題庫必須指定科目。",
          },
          { status: 400 }
        );
      }

      if (!examYear) {
        return NextResponse.json(
          {
            error: "公開國考題庫必須指定年份。",
          },
          { status: 400 }
        );
      }
    }

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
      });
    }

    /*
     * 建立題庫名稱
     */
    const cleanName =
      typeof name === "string" &&
      name.trim()
        ? name.trim()
        : finalVisibility === "public"
        ? `${examYear} ${examSubject} 國考題庫`
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
        ${finalVisibility === "public" ? examSubject : null},
        ${finalVisibility === "public" ? Number(examYear) : null}
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
          explanation
        )
        VALUES (
          ${questionSetId},
          ${index + 1},
          ${
            finalVisibility === "public"
              ? examSubject
              : "手動題庫"
          },
          ${question.question},
          ${question.options[0] ?? ""},
          ${question.options[1] ?? ""},
          ${question.options[2] ?? ""},
          ${question.options[3] ?? ""},
          ${question.answer},
          ${question.explanation}
        )
      `;
    }

    return NextResponse.json({
      success: true,
      message: `成功匯入 ${cleanedQuestions.length} 題。`,
      questionSetId,
      total: cleanedQuestions.length,
      visibility: finalVisibility,
      examSubject:
        finalVisibility === "public"
          ? examSubject
          : null,
      examYear:
        finalVisibility === "public"
          ? Number(examYear)
          : null,
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