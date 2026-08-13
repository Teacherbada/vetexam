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
     * 取得 Better Auth 登入狀態
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
     * 檢查目前使用者的會員方案
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
     * 取得上傳資料
     * ============================================================
     */

    const formData = await request.formData();

    const file = formData.get("file");
    const visibilityValue = formData.get("visibility");
    const examYearValue = formData.get("exam_year");
    const examSubjectValue = formData.get("exam_subject");

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
     * ============================================================
     */

    const examYear = Number(examYearValue);

    if (
      !Number.isInteger(examYear) ||
      examYear < 80 ||
      examYear > 200
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
     * 公開 / 私人權限
     *
     * 目前階段：
     *
     * PRO 使用者只能建立 private
     *
     * public 之後會開放給 admin。
     * ============================================================
     */

    let visibility: Visibility = "private";

    if (visibilityValue === "public") {
      return NextResponse.json(
        {
          error: "目前只有管理員可以建立公開題庫。",
          code: "ADMIN_REQUIRED",
        },
        { status: 403 }
      );
    }

    /*
     * 不管前端送什麼，只要不是 public，
     * 目前一律建立 private。
     */
    visibility = "private";

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
     * 計算 PDF SHA-256
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

      const pageText =
        textContent.items
          .map((item: any) =>
            "str" in item ? item.str : ""
          )
          .join(" ");

      fullText += pageText + "\n";

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
      text.substring(0, 5000)
    );

    if (!text) {
      return NextResponse.json(
        {
          error:
            "PDF 有成功讀取，但沒有偵測到文字。目前尚未支援掃描圖片型 PDF OCR。",
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
            "沒有辨識到選擇題。請確認 PDF 是文字型 PDF，且題目格式可以辨識。",
          textPreview: text.substring(0, 3000),
        },
        { status: 400 }
      );
    }

    /*
     * ============================================================
     * 檢查相同 PDF 是否已經匯入
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
      WHERE file_hash = ${fileHash}
      LIMIT 1
    `;

    if (existingSets.length > 0) {
      const existingSet = existingSets[0];

      console.log(
        "PDF API: 發現重複 PDF",
        existingSet.id
      );

      /*
       * 私人題庫只有建立者可以使用。
       */
      if (
        existingSet.visibility === "private" &&
        existingSet.owner_id !== userId
      ) {
        return NextResponse.json(
          {
            error:
              "這份 PDF 已經存在於其他使用者的私人題庫中。",
          },
          { status: 403 }
        );
      }

      const existingQuestions = await sql`
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

      const questionsForResponse: ParsedQuestion[] =
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
          "這份 PDF 已經匯入過，直接使用原本的題庫。",
        questionSetId: Number(existingSet.id),
        visibility: existingSet.visibility,
        ownerId: existingSet.owner_id,
        examYear: Number(existingSet.exam_year),
        examSubject: existingSet.exam_subject,
        total: questionsForResponse.length,
        questions: questionsForResponse,
        textLength: text.length,
        totalPages: pdf.numPages,
      });
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

    const insertedSets = await sql`
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
      questionSetId,
      "年份:",
      insertedSets[0].exam_year,
      "科目:",
      insertedSets[0].exam_subject,
      "visibility:",
      insertedSets[0].visibility,
      "owner_id:",
      insertedSets[0].owner_id
    );

    /*
     * ============================================================
     * 將題目寫入 questions
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
 * PDF 題目解析
 * ============================================================
 *
 * 支援：
 *
 * 1. 題目
 * 1、題目
 * 1) 題目
 * 1．題目
 *
 * A. 選項
 * B. 選項
 * C. 選項
 * D. 選項
 *
 * 也支援 PDF.js 把文字全部擠在同一行的情況。
 */

function parseQuestions(
  text: string
): ParsedQuestion[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  /*
   * 題號：
   *
   * 1.
   * 1、
   * 1)
   * 1．
   *
   * 注意：
   * 不使用原本錯誤的 \*。
   */
  const questionStartRegex =
    /(?=(?:^|\n)\s*\d+\s*[.、)．]\s+)/g;

  const blocks =
    normalized
      .split(questionStartRegex)
      .filter(
        (block) =>
          block.trim().length > 0
      );

  const questions: ParsedQuestion[] = [];

  for (const block of blocks) {
    const question =
      parseQuestionBlock(block);

    if (question) {
      questions.push(question);
    }
  }

  /*
   * 如果 PDF.js 把所有內容放在同一行，
   * 再嘗試第二種題號切割方式。
   */
  if (questions.length === 0) {
    return parseQuestionsInline(normalized);
  }

  return questions;
}

function parseQuestionsInline(
  text: string
): ParsedQuestion[] {
  const questionBlocks =
    text.split(
      /(?=\b\d{1,3}\s*[.、)．]\s*[^\d])/g
    );

  const questions: ParsedQuestion[] = [];

  for (const block of questionBlocks) {
    const question =
      parseQuestionBlock(block);

    if (question) {
      questions.push(question);
    }
  }

  return questions;
}

function parseQuestionBlock(
  block: string
): ParsedQuestion | null {
  const match = block.match(
    /^\s*(\d+)\s*[.、)．]\s*([\s\S]+)$/
  );

  if (!match) {
    return null;
  }

  const questionNumber =
    Number(match[1]);

  const content =
    match[2].trim();

  /*
   * 選項格式：
   *
   * A.
   * A、
   * A)
   * A．
   * A:
   * A：
   *
   * 同時避免把一般英文單字中的 A 誤判。
   */
  const optionRegex =
    /(?:^|\s|\n)([A-D])\s*[.、:：)．]\s*/gi;

  const optionMatches = [
    ...content.matchAll(optionRegex),
  ];

  if (optionMatches.length < 2) {
    return null;
  }

  const firstOptionIndex =
    optionMatches[0].index;

  if (firstOptionIndex === undefined) {
    return null;
  }

  const questionText =
    content
      .substring(0, firstOptionIndex)
      .replace(/\s+/g, " ")
      .trim();

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

    const end = next
      ? next.index ?? content.length
      : content.length;

    const optionText =
      content
        .substring(start, end)
        .replace(/\s+/g, " ")
        .trim();

    if (optionText) {
      options.push(optionText);
    }
  }

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
    options: options.slice(0, 4),
    answer: "",
    explanation: "",
  };
}