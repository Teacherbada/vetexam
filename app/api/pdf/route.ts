import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { createHash } from "crypto";

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

    const formData = await request.formData();

    const file = formData.get("file");
    const visibilityValue = formData.get("visibility");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          error: "沒有收到 PDF 檔案",
        },
        { status: 400 }
      );
    }

    const visibility: Visibility =
      visibilityValue === "public" ? "public" : "private";

    console.log("PDF API: 題庫可見性", visibility);

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

    const arrayBuffer = await file.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);

    const fileHash = createHash("sha256")
      .update(pdfBytes)
      .digest("hex");

    console.log("PDF API: SHA-256", fileHash);

    const pdfjsLib = await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );

    const loadingTask = pdfjsLib.getDocument({
      data: pdfBytes,
    });

    const pdf = await loadingTask.promise;

    console.log("PDF API: PDF 頁數", pdf.numPages);

    if (pdf.numPages > MAX_PAGES) {
      return NextResponse.json(
        {
          error: "PDF 頁數太多",
          detail: `目前單一 PDF 最大限制為 ${MAX_PAGES} 頁。`,
        },
        { status: 413 }
      );
    }

    let fullText = "";

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
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

    console.log("PDF API: 總文字長度", text.length);

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

    const sql = neon(databaseUrl);

    /*
     * 檢查相同 PDF 是否已經匯入。
     */
    const existingSets = await sql`
      SELECT
        id,
        name,
        filename,
        total_questions,
        created_at,
        file_hash,
        visibility
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
          subject: q.subject,
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
        total: questionsForResponse.length,
        questions: questionsForResponse,
        textLength: text.length,
        totalPages: pdf.numPages,
      });
    }

    /*
     * 建立新的題庫。
     */
    const setName =
      file.name.replace(/\.pdf$/i, "").trim() ||
      "未命名 PDF 題庫";

    const insertedSets = await sql`
      INSERT INTO question_sets (
        name,
        filename,
        file_hash,
        total_questions,
        visibility
      )
      VALUES (
        ${setName},
        ${file.name},
        ${fileHash},
        ${questions.length},
        ${visibility}
      )
      RETURNING id, visibility
    `;

    const questionSetId = Number(
      insertedSets[0].id
    );

    console.log(
      "PDF API: 建立題庫",
      questionSetId,
      "visibility:",
      insertedSets[0].visibility
    );

    /*
     * 將解析後的題目寫入 questions。
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
          ${question.subject},
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
      message: "PDF 匯入成功，題目已永久保存。",
      questionSetId,
      visibility,
      total: questions.length,
      questions,
      textLength: text.length,
      totalPages: pdf.numPages,
    });
  } catch (error) {
    console.error("PDF parsing error:", error);

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

  const blocks = normalized.split(
    /(?=\n?\s*\d+\s*[.、)．]\s+)/
  );

  const questions: ParsedQuestion[] = [];

  for (const block of blocks) {
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

  const questionNumber = Number(match[1]);
  const content = match[2].trim();

  const optionRegex =
    /(?:^|\n|\s)(?:\(?([A-D])\)?\s*[.、:：)．]\s*)/gi;

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

  const questionText = content
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
    const current = optionMatches[i];

    const start =
      (current.index ?? 0) +
      current[0].length;

    const next = optionMatches[i + 1];

    const end = next
      ? next.index ?? content.length
      : content.length;

    const optionText = content
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