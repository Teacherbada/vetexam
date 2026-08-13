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
     * Better Auth 登入狀態
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

    /*
     * ============================================================
     * ADMIN
     * ============================================================
     */
    const adminUserId = process.env.ADMIN_USER_ID?.trim();

    const isAdmin =
      !!adminUserId &&
      adminUserId === userId;

    console.log("PDF API: userId", userId);
    console.log("PDF API: isAdmin", isAdmin);

    const sql = neon(databaseUrl);

    /*
     * ============================================================
     * 會員方案
     *
     * ADMIN 不需要 PRO。
     * 一般使用者仍然需要 PRO。
     * ============================================================
     */
    if (!isAdmin) {
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
    }

    /*
     * ============================================================
     * 取得上傳資料
     *
     * 同時支援：
     * examSubject / exam_subject
     * examYear / exam_year
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
     * 國考年份
     * ============================================================
     */
    const examYear =
      examYearValue === null ||
      examYearValue === ""
        ? null
        : Number(examYearValue);

    if (
      examYear !== null &&
      (
        !Number.isInteger(examYear) ||
        examYear < 80 ||
        examYear > 200
      )
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
     * 國考科目
     * ============================================================
     */
    const examSubject =
      typeof examSubjectValue === "string"
        ? examSubjectValue.trim()
        : "";

    /*
     * ============================================================
     * 公開 / 私人
     *
     * ADMIN：
     *   可以 public / private
     *
     * 一般使用者：
     *   強制 private
     * ============================================================
     */
    let visibility: Visibility = "private";

    if (isAdmin) {
      if (
        visibilityValue === "public" ||
        visibilityValue === "private"
      ) {
        visibility =
          visibilityValue as Visibility;
      }
    } else {
      visibility = "private";

      if (visibilityValue === "public") {
        return NextResponse.json(
          {
            error: "目前只有管理員可以建立公開題庫。",
            code: "ADMIN_REQUIRED",
          },
          { status: 403 }
        );
      }
    }

    console.log(
      "PDF API: 國考年份",
      examYear
    );

    console.log(
      "PDF API: 國考科目",
      examSubject
    );

    console.log(
      "PDF API: 題庫可見性",
      visibility
    );

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
          detail:
            "目前單一 PDF 最大限制為 10 MB。",
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
    const arrayBuffer =
      await file.arrayBuffer();

    const pdfBytes =
      new Uint8Array(arrayBuffer);

    const fileHash =
      createHash("sha256")
        .update(pdfBytes)
        .digest("hex");

    console.log(
      "PDF API: SHA-256",
      fileHash
    );

    /*
     * ============================================================
     * PDF.js
     * ============================================================
     */
    const pdfjsLib = await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );

    const loadingTask =
      pdfjsLib.getDocument({
        data: pdfBytes,
      });

    const pdf =
      await loadingTask.promise;

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
      const page =
        await pdf.getPage(pageNumber);

      const textContent =
        await page.getTextContent();

      const pageText =
        textContent.items
          .map((item: any) =>
            "str" in item
              ? item.str
              : ""
          )
          .join(" ");

      fullText +=
        pageText + "\n";

      console.log(
        `PDF API: 第 ${pageNumber} 頁文字長度`,
        pageText.length
      );
    }

    const text =
      fullText.trim();

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
    const questions =
      parseQuestions(text);

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
          textPreview:
            text.substring(0, 3000),
        },
        { status: 400 }
      );
    }

    /*
     * ============================================================
     * 重複 PDF 判定
     *
     * 規則：
     *
     * 1. 同一個一般使用者：
     *    同一份 PDF → 使用自己原本的題庫
     *
     * 2. 不同一般使用者：
     *    可以上傳相同 PDF
     *
     * 3. 已存在公開國考題庫：
     *    一般使用者 → 不建立私人副本
     *
     * 4. ADMIN：
     *    完全忽略以上限制
     *    可以重新匯入
     *    可以建立 public
     *    不會因其他使用者上傳相同 PDF 而被擋
     * ============================================================
     */
    if (!isAdmin) {
      /*
       * ------------------------------------------------------------
       * 先找「自己的私人題庫」
       * ------------------------------------------------------------
       */
      const ownPrivateSets = await sql`
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
        WHERE owner_id = ${userId}
          AND file_hash = ${fileHash}
          AND visibility = 'private'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (ownPrivateSets.length > 0) {
        const existingSet =
          ownPrivateSets[0];

        console.log(
          "PDF API: 使用者自己已經匯入過",
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
            WHERE question_set_id =
              ${existingSet.id}
            ORDER BY question_number ASC
          `;

        const questionsForResponse:
          ParsedQuestion[] =
            existingQuestions.map(
              (q: any) => ({
                id:
                  Number(
                    q.question_number
                  ),
                subject:
                  q.subject ??
                  existingSet.exam_subject ??
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
          duplicateType:
            "own_private",
          message:
            "這份 PDF 已經匯入過，直接使用你原本的私人題庫。",
          questionSetId:
            Number(existingSet.id),
          visibility:
            existingSet.visibility,
          ownerId:
            existingSet.owner_id,
          examYear:
            existingSet.exam_year === null
              ? null
              : Number(
                  existingSet.exam_year
                ),
          examSubject:
            existingSet.exam_subject,
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

      /*
       * ------------------------------------------------------------
       * 再檢查是否已經存在「公開國考題庫」
       *
       * 注意：
       * 只擋 public。
       *
       * 不會擋其他人的 private。
       * ------------------------------------------------------------
       */
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
        WHERE file_hash = ${fileHash}
          AND visibility = 'public'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (publicSets.length > 0) {
        const existingPublicSet =
          publicSets[0];

        console.log(
          "PDF API: 發現已存在的公開國考題庫",
          existingPublicSet.id
        );

        return NextResponse.json(
          {
            error:
              "這份 PDF 已經存在於公開國考題庫，不需要再次匯入。",
            code:
              "PUBLIC_QUESTION_SET_EXISTS",
            questionSetId:
              Number(
                existingPublicSet.id
              ),
            examYear:
              existingPublicSet.exam_year ===
              null
                ? null
                : Number(
                    existingPublicSet.exam_year
                  ),
            examSubject:
              existingPublicSet.exam_subject,
          },
          { status: 409 }
        );
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
      (
        examYear !== null &&
        examSubject
          ? `${examYear} 年 ${examSubject}`
          : "PDF 題庫"
      );

    /*
     * ============================================================
     * 建立 question_sets
     *
     * ADMIN：
     *   public / private 都可以
     *
     * 一般使用者：
     *   private
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
          ${examSubject || null}
        )
        RETURNING
          id,
          visibility,
          owner_id,
          exam_year,
          exam_subject
      `;

    const questionSetId =
      Number(
        insertedSets[0].id
      );

    console.log(
      "PDF API: 建立題庫",
      questionSetId
    );

    console.log(
      "PDF API: 年份:",
      insertedSets[0].exam_year
    );

    console.log(
      "PDF API: 科目:",
      insertedSets[0].exam_subject
    );

    console.log(
      "PDF API: visibility:",
      insertedSets[0].visibility
    );

    console.log(
      "PDF API: owner_id:",
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
          ${examSubject || question.subject},
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

    /*
     * ============================================================
     * 成功
     * ============================================================
     */
    return NextResponse.json({
      success: true,
      duplicate: false,
      message:
        visibility === "public"
          ? "PDF 已成功匯入公開國考題庫。"
          : "PDF 匯入成功，題目已永久保存。",
      questionSetId,
      visibility,
      ownerId: userId,
      isAdmin,
      examYear,
      examSubject:
        examSubject || null,
      total:
        questions.length,
      questions,
      textLength:
        text.length,
      totalPages:
        pdf.numPages,
    });
  } catch (error) {
    console.error(
      "PDF parsing error:",
      error
    );

    /*
     * UNIQUE constraint：
     * 同一個使用者同一份 PDF
     *
     * 即使兩個請求同時進來，
     * DB unique index 仍然是最後一道保護。
     */
    if (
      error instanceof Error &&
      (
        error.message.includes(
          "idx_question_sets_owner_file_hash"
        ) ||
        error.message.includes(
          "duplicate key"
        ) ||
        error.message.includes(
          "unique constraint"
        )
      )
    ) {
      return NextResponse.json(
        {
          error:
            "這份 PDF 已經匯入過你的私人題庫。",
          code:
            "OWN_PRIVATE_DUPLICATE",
        },
        { status: 409 }
      );
    }

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
 * ============================================================
 */
function parseQuestions(
  text: string
): ParsedQuestion[] {
  const normalized =
    text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const questionStartRegex =
    /(?=(?:^|\n)\s*\d+\s*[.、)．]\s+)/g;

  const blocks =
    normalized
      .split(questionStartRegex)
      .filter(
        (block) =>
          block.trim().length > 0
      );

  const questions:
    ParsedQuestion[] = [];

  for (const block of blocks) {
    const question =
      parseQuestionBlock(block);

    if (question) {
      questions.push(question);
    }
  }

  if (questions.length === 0) {
    return parseQuestionsInline(
      normalized
    );
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

  const questions:
    ParsedQuestion[] = [];

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
  const match =
    block.match(
      /^\s*(\d+)\s*[.、)．]\s*([\s\S]+)$/
    );

  if (!match) {
    return null;
  }

  const questionNumber =
    Number(match[1]);

  const content =
    match[2].trim();

  const optionRegex =
    /(?:^|\s|\n)([A-D])\s*[.、:：)．]\s*/gi;

  const optionMatches = [
    ...content.matchAll(
      optionRegex
    ),
  ];

  if (optionMatches.length < 2) {
    return null;
  }

  const firstOptionIndex =
    optionMatches[0].index;

  if (
    firstOptionIndex ===
    undefined
  ) {
    return null;
  }

  const questionText =
    content
      .substring(
        0,
        firstOptionIndex
      )
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
      ? next.index ??
        content.length
      : content.length;

    const optionText =
      content
        .substring(
          start,
          end
        )
        .replace(/\s+/g, " ")
        .trim();

    if (optionText) {
      options.push(
        optionText
      );
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
    options:
      options.slice(0, 4),
    answer: "",
    explanation: "",
  };
}