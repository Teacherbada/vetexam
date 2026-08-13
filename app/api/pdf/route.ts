import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PAGES = 200;

type ParsedQuestion = {
  id: number;
  subject: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

type Visibility = "public" | "private";

export async function POST(request: Request) {
  try {
    console.log("PDF API: 開始接收檔案");

    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      console.error("PDF API: 找不到 DATABASE_URL");

      return NextResponse.json(
        {
          error: "伺服器資料庫設定錯誤",
        },
        { status: 500 }
      );
    }

    /*
     * ============================================================
     * Better Auth 登入
     * ============================================================
     */

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "請先登入才能上傳 PDF。",
        },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const sql = neon(databaseUrl);

    /*
     * ============================================================
     * 會員方案
     * ============================================================
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
          error: "目前只有 PRO 會員可以上傳 PDF 題庫。",
          code: "PRO_REQUIRED",
        },
        { status: 403 }
      );
    }

    /*
     * ============================================================
     * FormData
     * ============================================================
     */

    const formData = await request.formData();

    const file = formData.get("file");
    const visibilityValue = formData.get("visibility");
    const examYearValue =
      formData.get("examYear") ??
      formData.get("exam_year");

    const examSubjectValue =
      formData.get("examSubject") ??
      formData.get("exam_subject");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: "沒有收到 PDF 檔案",
        },
        { status: 400 }
      );
    }

    /*
     * ============================================================
     * 年份
     *
     * 前端顯示：
     * 115
     *
     * API / DB：
     * 2026
     *
     * 同時接受：
     * 115 → 2026
     * 114 → 2025
     *
     * 如果前端已經送西元年，也可以接受。
     * ============================================================
     */

    let examYear = Number(examYearValue);

    if (!Number.isInteger(examYear)) {
      return NextResponse.json(
        {
          error: "請選擇有效的國考年份。",
        },
        { status: 400 }
      );
    }

    if (examYear >= 80 && examYear <= 200) {
      examYear += 1911;
    }

    if (
      !Number.isInteger(examYear) ||
      examYear < 1990 ||
      examYear > 2100
    ) {
      return NextResponse.json(
        {
          error: "請選擇有效的國考年份。",
        },
        { status: 400 }
      );
    }

    /*
     * ============================================================
     * 科目
     * ============================================================
     */

    const examSubject =
      typeof examSubjectValue === "string"
        ? examSubjectValue.trim()
        : "";

    if (!examSubject) {
      return NextResponse.json(
        {
          error: "請選擇國考科目。",
        },
        { status: 400 }
      );
    }

    /*
     * ============================================================
     * 公開 / 私人
     *
     * 一般使用者目前只能 private。
     * ADMIN_USER_ID 可以使用特殊管理流程。
     * ============================================================
     */

    let visibility: Visibility = "private";

    if (visibilityValue === "public") {
      const adminUserId = process.env.ADMIN_USER_ID;

      if (!adminUserId || adminUserId !== userId) {
        return NextResponse.json(
          {
            error: "目前只有管理員可以建立公開題庫。",
            code: "ADMIN_REQUIRED",
          },
          { status: 403 }
        );
      }

      visibility = "public";
    }

    console.log("PDF API: 國考年份", examYear);
    console.log("PDF API: 國考科目", examSubject);
    console.log("PDF API: 題庫可見性", visibility);
    console.log("PDF API: owner_id", userId);

    /*
     * ============================================================
     * PDF 檔案檢查
     * ============================================================
     */

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        {
          error: "目前只接受 PDF 檔案",
        },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        {
          error: "PDF 檔案是空的",
        },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: "PDF 檔案太大",
          detail: "目前單一 PDF 最大限制為 10 MB。",
        },
        { status: 413 }
      );
    }

    console.log(
      "PDF API: 收到檔案",
      file.name,
      `${(file.size / 1024 / 1024).toFixed(2)} MB`
    );

    /*
     * ============================================================
     * SHA-256
     * ============================================================
     */

    const arrayBuffer = await file.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);

    const fileHash = createHash("sha256")
      .update(pdfBytes)
      .digest("hex");

    console.log("PDF API: SHA-256", fileHash);

    /*
     * ============================================================
     * PDF.js
     * ============================================================
     */

    const pdfjsLib = await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );

    const loadingTask = pdfjsLib.getDocument({
      data: pdfBytes,
    });

    const pdf = await loadingTask.promise;

    console.log(
      "PDF API: PDF 頁數",
      pdf.numPages
    );

    if (pdf.numPages > MAX_PAGES) {
      return NextResponse.json(
        {
          error: "PDF 頁數太多",
          detail:
            `目前單一 PDF 最大限制為 ${MAX_PAGES} 頁。`,
        },
        { status: 413 }
      );
    }

    /*
     * ============================================================
     * 讀取 PDF 全文
     *
     * 這裡特別重要：
     *
     * 不再單純使用 item.str.join(" ")
     *
     * 因為圖片、雙欄排版、PDF 排版物件會造成文字順序
     * 與題號位置異常。
     *
     * 先保留 PDF.js 的 item 順序，再加入換行。
     * ============================================================
     */

    let fullText = "";

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber);

      const textContent =
        await page.getTextContent();

      const items = textContent.items
        .filter(
          (item: any) =>
            typeof item.str === "string" &&
            item.str.trim() !== ""
        )
        .map((item: any) => ({
          text: item.str.trim(),
          x: Number(item.transform?.[4] ?? 0),
          y: Number(item.transform?.[5] ?? 0),
        }));

      /*
       * 依 Y 座標重新建立近似閱讀順序。
       *
       * 對於：
       * - 圖片題
       * - 雙欄 PDF
       * - 題目跨行
       * - PDF.js 把文字拆碎
       *
       * 都比單純 join(" ") 穩定。
       */

      const sortedItems = [...items].sort(
        (a, b) => {
          const yDiff = Math.abs(a.y - b.y);

          if (yDiff < 4) {
            return a.x - b.x;
          }

          return b.y - a.y;
        }
      );

      const lines: string[] = [];

      for (const item of sortedItems) {
        if (!item.text) {
          continue;
        }

        const previous =
          lines[lines.length - 1];

        if (!previous) {
          lines.push(item.text);
          continue;
        }

        /*
         * PDF.js 的 Y 座標已經被排序。
         * 這裡使用空白保留同一行文字。
         */
        lines[lines.length - 1] =
          `${previous} ${item.text}`.trim();
      }

      const pageText = lines.join("\n");

      fullText +=
        `\n\n===== PDF PAGE ${pageNumber} =====\n\n` +
        pageText +
        "\n";

      console.log(
        `PDF API: 第 ${pageNumber} 頁文字長度`,
        pageText.length
      );
    }

    const text = fullText.trim();

    console.log(
      "PDF API: 總文字長度",
      text.length
    );

    console.log(
      "PDF RAW TEXT:",
      text.substring(0, 8000)
    );

    if (!text) {
      return NextResponse.json(
        {
          error:
            "PDF 有成功讀取，但沒有偵測到文字。目前尚未支援純掃描圖片型 PDF OCR。",
        },
        { status: 400 }
      );
    }

    /*
     * ============================================================
     * 題目解析
     * ============================================================
     */

    const questions = parseQuestions(text);

    console.log(
      "PDF API: 成功辨識",
      questions.length,
      "題"
    );

    if (questions.length === 0) {
      return NextResponse.json(
        {
          error:
            "沒有辨識到選擇題。請確認 PDF 題目格式。",
          textPreview: text.substring(0, 5000),
        },
        { status: 400 }
      );
    }

    /*
     * ============================================================
     * 同一使用者：
     *
     * 同一 PDF → 不重複建立
     *
     * 不同使用者：
     * 可以使用同一 PDF。
     *
     * 這裡不再阻擋別人的 private PDF。
     * ============================================================
     */

    const existingSets = await sql`
      SELECT
        id,
        name,
        filename,
        total_questions,
        created_at,
        file_hash,
        visibility,
        owner_id,
        exam_year,
        exam_subject
      FROM question_sets
      WHERE
        file_hash = ${fileHash}
        AND owner_id = ${userId}
      LIMIT 1
    `;

    if (existingSets.length > 0) {
      const existingSet =
        existingSets[0];

      console.log(
        "PDF API: 使用者已經匯入過這份 PDF",
        existingSet.id
      );

      const existingQuestions =
        await sql`
          SELECT
            question_number,
            subject,
            question,
            option_a,
            option_b,
            option_c,
            option_d,
            answer,
            explanation
          FROM questions
          WHERE question_set_id = ${existingSet.id}
          ORDER BY question_number ASC
        `;

      const questionsForResponse:
        ParsedQuestion[] =
        existingQuestions.map((q: any) => ({
          id: Number(q.question_number),
          subject:
            q.subject ??
            existingSet.exam_subject ??
            "",
          question: q.question,
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
        duplicate: true,
        message:
          "這份 PDF 已經匯入過，直接使用原本的私人題庫。",
        questionSetId:
          Number(existingSet.id),
        visibility:
          existingSet.visibility,
        ownerId:
          existingSet.owner_id,
        examYear:
          Number(existingSet.exam_year),
        examSubject:
          existingSet.exam_subject,
        total:
          questionsForResponse.length,
        questions:
          questionsForResponse,
        textLength: text.length,
        totalPages: pdf.numPages,
      });
    }

    /*
     * ============================================================
     * 管理員公開題庫：
     *
     * 如果同一份 PDF 已存在公開國考題庫，
     * 管理員可以取得它，而不是被其他使用者 private 題庫影響。
     * ============================================================
     */

    if (userId === process.env.ADMIN_USER_ID) {
      const publicSets = await sql`
        SELECT
          id,
          name,
          filename,
          total_questions,
          created_at,
          file_hash,
          visibility,
          owner_id,
          exam_year,
          exam_subject
        FROM question_sets
        WHERE
          file_hash = ${fileHash}
          AND visibility = 'public'
        LIMIT 1
      `;

      if (publicSets.length > 0) {
        const publicSet =
          publicSets[0];

        const publicQuestions =
          await sql`
            SELECT
              question_number,
              subject,
              question,
              option_a,
              option_b,
              option_c,
              option_d,
              answer,
              explanation
            FROM questions
            WHERE question_set_id = ${publicSet.id}
            ORDER BY question_number ASC
          `;

        const questionsForResponse:
          ParsedQuestion[] =
          publicQuestions.map(
            (q: any) => ({
              id: Number(
                q.question_number
              ),
              subject:
                q.subject ??
                publicSet.exam_subject ??
                "",
              question:
                q.question,
              options: [
                q.option_a ?? "",
                q.option_b ?? "",
                q.option_c ?? "",
                q.option_d ?? "",
              ],
              answer:
                q.answer ?? "",
              explanation:
                q.explanation ?? "",
            })
          );

        return NextResponse.json({
          success: true,
          duplicate: true,
          message:
            "這份 PDF 已經存在於公開國考題庫。",
          questionSetId:
            Number(publicSet.id),
          visibility:
            publicSet.visibility,
          ownerId:
            publicSet.owner_id,
          examYear:
            Number(publicSet.exam_year),
          examSubject:
            publicSet.exam_subject,
          total:
            questionsForResponse.length,
          questions:
            questionsForResponse,
          textLength:
            text.length,
          totalPages:
            pdf.numPages,
        });
      }
    }

    /*
     * ============================================================
     * 建立題庫名稱
     * ============================================================
     */

    const setName =
      file.name
        .replace(/\.pdf$/i, "")
        .trim() ||
      `${examYear} 年 ${examSubject}`;

    /*
     * ============================================================
     * 建立 question_sets
     * ============================================================
     */

    const insertedSets =
      await sql`
        INSERT INTO question_sets (
          name,
          filename,
          file_hash,
          total_questions,
          visibility,
          owner_id,
          exam_year,
          exam_subject
        )
        VALUES (
          ${setName},
          ${file.name},
          ${fileHash},
          ${questions.length},
          ${visibility},
          ${userId},
          ${examYear},
          ${examSubject}
        )
        RETURNING
          id,
          visibility,
          owner_id,
          exam_year,
          exam_subject
      `;

    const questionSetId =
      Number(insertedSets[0].id);

    console.log(
      "PDF API: 建立題庫",
      questionSetId
    );

    /*
     * ============================================================
     * 寫入 questions
     * ============================================================
     */

    for (const question of questions) {
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
          ${question.id},
          ${examSubject},
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

    console.log(
      "PDF API: 已將",
      questions.length,
      "題寫入 Neon"
    );

    return NextResponse.json({
      success: true,
      duplicate: false,
      message:
        "PDF 匯入成功，題目已永久保存。",
      questionSetId,
      visibility,
      ownerId: userId,
      examYear,
      examSubject,
      total: questions.length,
      questions,
      textLength: text.length,
      totalPages: pdf.numPages,
    });
  } catch (error) {
    console.error(
      "PDF parsing error:",
      error
    );

    return NextResponse.json(
      {
        error: "PDF 解析失敗",
        detail:
          error instanceof Error
            ? error.message
            : "未知錯誤",
      },
      { status: 500 }
    );
  }
}

/*
 * ============================================================
 * PDF 題目解析器
 *
 * 重點：
 *
 * 舊版：
 *   題號必須出現在行首
 *
 * 新版：
 *   題號可以出現在：
 *
 *   1.
 *   1、
 *   1)
 *   1．
 *
 *   甚至：
 *
 *   ...上一個選項 D... 2. 下一題...
 *
 * 這對圖片題、雙欄 PDF、PDF.js 排版非常重要。
 * ============================================================
 */

function parseQuestions(
  text: string
): ParsedQuestion[] {
  const normalized =
    normalizePdfText(text);

  /*
   * 找所有題號。
   *
   * 不再要求 ^ 或 \n。
   *
   * 但前面必須不是數字，
   * 避免把：
   *
   * 2026.123
   *
   * 之類誤判。
   */

  const questionStartRegex =
    /(?:^|(?<=[\s>。！？：:；;）)]))(\d{1,3})\s*[.、)．]\s*/g;

  const matches = [
    ...normalized.matchAll(
      questionStartRegex
    ),
  ];

  const questions: ParsedQuestion[] = [];

  if (matches.length === 0) {
    return parseQuestionsInline(
      normalized
    );
  }

  for (
    let index = 0;
    index < matches.length;
    index++
  ) {
    const match = matches[index];

    const questionNumber =
      Number(match[1]);

    const start =
      (match.index ?? 0) +
      match[0].length;

    const next =
      matches[index + 1];

    const end =
      next?.index ??
      normalized.length;

    const content =
      normalized
        .substring(start, end)
        .trim();

    const question =
      parseQuestionContent(
        questionNumber,
        content
      );

    if (question) {
      questions.push(question);
    }
  }

  /*
   * 題號可能重複或順序異常。
   *
   * 去除完全重複的題號。
   */

  const unique =
    new Map<number, ParsedQuestion>();

  for (const question of questions) {
    if (!unique.has(question.id)) {
      unique.set(
        question.id,
        question
      );
    }
  }

  return [...unique.values()].sort(
    (a, b) => a.id - b.id
  );
}

/*
 * ============================================================
 * 文字正規化
 * ============================================================
 */

function normalizePdfText(
  text: string
): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(
      /===== PDF PAGE \d+ =====/g,
      "\n"
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/*
 * ============================================================
 * 題目內容解析
 * ============================================================
 */

function parseQuestionContent(
  questionNumber: number,
  content: string
): ParsedQuestion | null {
  if (!content) {
    return null;
  }

  /*
   * 支援：
   *
   * A.
   * A、
   * A)
   * A．
   * A:
   * A：
   *
   * 以及 PDF 常見的：
   *
   * （A）
   * (A)
   *
   * 避免英文單字中的 A 被誤判。
   */

  const optionRegex =
    /(?:^|[\s\n])(?:[（(]\s*)?([A-D])(?:\s*[）)])?\s*[.、:：．]\s*/gi;

  const optionMatches = [
    ...content.matchAll(
      optionRegex
    ),
  ];

  if (optionMatches.length < 2) {
    return null;
  }

  const firstOption =
    optionMatches[0];

  const firstOptionIndex =
    firstOption.index;

  if (
    firstOptionIndex === undefined
  ) {
    return null;
  }

  let questionText =
    content
      .substring(
        0,
        firstOptionIndex
      )
      .trim();

  /*
   * 如果圖片 / PDF 排版造成一些孤立字元，
   * 清理頭尾。
   */

  questionText =
    cleanQuestionText(
      questionText
    );

  if (!questionText) {
    return null;
  }

  const options: string[] = [];

  for (
    let i = 0;
    i < optionMatches.length;
    i++
  ) {
    const current =
      optionMatches[i];

    const start =
      (current.index ?? 0) +
      current[0].length;

    const next =
      optionMatches[i + 1];

    const end =
      next?.index ??
      content.length;

    const optionText =
      cleanOptionText(
        content.substring(
          start,
          end
        )
      );

    if (optionText) {
      options.push(optionText);
    }
  }

  /*
   * 國考一般為四選一。
   *
   * 如果超過四個，
   * 只保留前四個。
   */

  if (options.length < 2) {
    return null;
  }

  while (options.length < 4) {
    options.push("");
  }

  return {
    id: questionNumber,
    subject: "PDF 題庫",
    question: questionText,
    options:
      options.slice(0, 4),
    answer: "",
    explanation: "",
  };
}

/*
 * ============================================================
 * 清理題目
 * ============================================================
 */

function cleanQuestionText(
  text: string
): string {
  return text
    .replace(
      /^(?:第\s*)?\d{1,3}\s*[.、)．]\s*/,
      ""
    )
    .replace(
      /===== PDF PAGE \d+ =====/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * ============================================================
 * 清理選項
 * ============================================================
 */

function cleanOptionText(
  text: string
): string {
  return text
    .replace(
      /===== PDF PAGE \d+ =====/g,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * ============================================================
 * fallback
 *
 * 如果 PDF 全部變成一行，
 * 使用較寬鬆的題號偵測。
 * ============================================================
 */

function parseQuestionsInline(
  text: string
): ParsedQuestion[] {
  const questionBlocks =
    text.split(
      /(?<!\d)(\d{1,3})\s*[.、)．]\s*(?=[^\d])/g
    );

  const questions: ParsedQuestion[] =
    [];

  /*
   * split() 會把題號本身拆出去，
   * 所以用兩兩組合。
   */

  for (
    let i = 1;
    i < questionBlocks.length;
    i += 2
  ) {
    const questionNumber =
      Number(
        questionBlocks[i]
      );

    const content =
      questionBlocks[i + 1] ??
      "";

    const question =
      parseQuestionContent(
        questionNumber,
        content
      );

    if (question) {
      questions.push(question);
    }
  }

  return questions.sort(
    (a, b) => a.id - b.id
  );
}