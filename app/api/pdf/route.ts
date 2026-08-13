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
      return NextResponse.json(
        { error: "伺服器資料庫設定錯誤" },
        { status: 500 }
      );
    }

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "請先登入才能上傳 PDF。" },
        { status: 401 }
      );
    }

    const userId = session.user.id;
    const sql = neon(databaseUrl);

    const subscriptions = await sql`
      SELECT plan, status, expires_at
      FROM subscriptions
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    const subscription = subscriptions[0];

    const isPro =
      subscription?.plan === "pro" &&
      subscription?.status === "active" &&
      (subscription?.expires_at === null ||
        subscription?.expires_at === undefined ||
        new Date(subscription.expires_at) > new Date());

    if (!isPro) {
      return NextResponse.json(
        {
          error: "目前只有 PRO 會員可以上傳 PDF 題庫。",
          code: "PRO_REQUIRED",
        },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const visibilityValue = formData.get("visibility");
    const examYearValue =
      formData.get("examYear") ?? formData.get("exam_year");
    const examSubjectValue =
      formData.get("examSubject") ?? formData.get("exam_subject");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "沒有收到 PDF 檔案" },
        { status: 400 }
      );
    }

    let examYear = Number(examYearValue);

    if (!Number.isInteger(examYear)) {
      return NextResponse.json(
        { error: "請選擇有效的國考年份。" },
        { status: 400 }
      );
    }

    if (examYear >= 80 && examYear <= 200) {
      examYear += 1911;
    }

    if (examYear < 1990 || examYear > 2100) {
      return NextResponse.json(
        { error: "請選擇有效的國考年份。" },
        { status: 400 }
      );
    }

    const examSubject =
      typeof examSubjectValue === "string"
        ? examSubjectValue.trim()
        : "";

    if (!examSubject) {
      return NextResponse.json(
        { error: "請選擇國考科目。" },
        { status: 400 }
      );
    }

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

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { error: "目前只接受 PDF 檔案" },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "PDF 檔案是空的" },
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

    const arrayBuffer = await file.arrayBuffer();
    const pdfBytes = new Uint8Array(arrayBuffer);

    const fileHash = createHash("sha256")
      .update(pdfBytes)
      .digest("hex");

    const pdfjsLib = await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );

    const loadingTask = pdfjsLib.getDocument({
      data: pdfBytes,
    });

    const pdf = await loadingTask.promise;

    if (pdf.numPages > MAX_PAGES) {
      return NextResponse.json(
        {
          error: "PDF 頁數太多",
          detail: `目前單一 PDF 最大限制為 ${MAX_PAGES} 頁。`,
        },
        { status: 413 }
      );
    }

    /*
     * PDF 文字擷取 v2
     *
     * 舊版的重大問題是把所有 item 都接到同一個 lines[最後一行]，
     * 導致整頁甚至整份 PDF 很容易變成一長串文字。
     *
     * 現在依 PDF.js 的 x/y 座標建立真正的文字行，再依行序輸出。
     * 這對圖片題、跨行題目、雙欄排版會穩定很多。
     */
    let fullText = "";

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber++
    ) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const items = textContent.items
        .filter(
          (item: any) =>
            typeof item.str === "string" && item.str.trim() !== ""
        )
        .map((item: any) => ({
          text: item.str.trim(),
          x: Number(item.transform?.[4] ?? 0),
          y: Number(item.transform?.[5] ?? 0),
          width: Number(item.width ?? 0),
        }))
        .sort((a, b) => {
          const yDiff = Math.abs(a.y - b.y);

          if (yDiff <= 3) {
            return a.x - b.x;
          }

          return b.y - a.y;
        });

      const lines: Array<{
        y: number;
        items: Array<{
          text: string;
          x: number;
          width: number;
        }>;
      }> = [];

      for (const item of items) {
        const line = lines.find(
          (candidate) => Math.abs(candidate.y - item.y) <= 3
        );

        if (line) {
          line.items.push(item);
          line.items.sort((a, b) => a.x - b.x);
        } else {
          lines.push({
            y: item.y,
            items: [
              {
                text: item.text,
                x: item.x,
                width: item.width,
              },
            ],
          });
        }
      }

      lines.sort((a, b) => b.y - a.y);

      const pageLines = lines.map((line) => {
        let result = "";
        let previousEnd = -Infinity;

        for (const item of line.items) {
          const gap = item.x - previousEnd;
          const separator = result && gap > 2 ? " " : "";
          result += separator + item.text;
          previousEnd = item.x + item.width;
        }

        return result.trim();
      });

      const pageText = pageLines
        .filter(Boolean)
        .join("\n");

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

    if (!text) {
      return NextResponse.json(
        {
          error:
            "PDF 有成功讀取，但沒有偵測到文字。目前尚未支援純掃描圖片型 PDF OCR。",
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
          error: "沒有辨識到選擇題。請確認 PDF 題目格式。",
          textPreview: text.substring(0, 5000),
        },
        { status: 400 }
      );
    }

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
        AND owner_id = ${userId}
      LIMIT 1
    `;

    if (existingSets.length > 0) {
      const existingSet = existingSets[0];

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
          subject: q.subject ?? existingSet.exam_subject ?? "",
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
        message: "這份 PDF 已經匯入過，直接使用原本的私人題庫。",
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
        WHERE file_hash = ${fileHash}
          AND visibility = 'public'
        LIMIT 1
      `;

      if (publicSets.length > 0) {
        const publicSet = publicSets[0];

        const publicQuestions = await sql`
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

        const questionsForResponse: ParsedQuestion[] =
          publicQuestions.map((q: any) => ({
            id: Number(q.question_number),
            subject: q.subject ?? publicSet.exam_subject ?? "",
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
          message: "這份 PDF 已經存在於公開國考題庫。",
          questionSetId: Number(publicSet.id),
          visibility: publicSet.visibility,
          ownerId: publicSet.owner_id,
          examYear: Number(publicSet.exam_year),
          examSubject: publicSet.exam_subject,
          total: questionsForResponse.length,
          questions: questionsForResponse,
          textLength: text.length,
          totalPages: pdf.numPages,
        });
      }
    }

    const setName =
      file.name.replace(/\.pdf$/i, "").trim() ||
      `${examYear} 年 ${examSubject}`;

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
      RETURNING id, visibility, owner_id, exam_year, exam_subject
    `;

    const questionSetId = Number(insertedSets[0].id);

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

    return NextResponse.json({
      success: true,
      duplicate: false,
      message: "PDF 匯入成功，題目已永久保存。",
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
    console.error("PDF parsing error:", error);

    return NextResponse.json(
      {
        error: "PDF 解析失敗",
        detail:
          error instanceof Error ? error.message : "未知錯誤",
      },
      { status: 500 }
    );
  }
}

function parseQuestions(text: string): ParsedQuestion[] {
  const normalized = normalizePdfText(text);

  const questionStartRegex =
    /(?:^|(?<=[\s>。！？：:；;）)]))(\d{1,3})\s*[.、)．]\s*/g;

  const matches = [...normalized.matchAll(questionStartRegex)];
  const questions: ParsedQuestion[] = [];

  if (matches.length === 0) {
    return parseQuestionsInline(normalized);
  }

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const questionNumber = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const next = matches[index + 1];
    const end = next?.index ?? normalized.length;
    const content = normalized.substring(start, end).trim();

    const question = parseQuestionContent(
      questionNumber,
      content
    );

    if (question) {
      questions.push(question);
    }
  }

  const unique = new Map<number, ParsedQuestion>();

  for (const question of questions) {
    if (!unique.has(question.id)) {
      unique.set(question.id, question);
    }
  }

  return [...unique.values()].sort((a, b) => a.id - b.id);
}

function normalizePdfText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/===== PDF PAGE \d+ =====/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseQuestionContent(
  questionNumber: number,
  content: string
): ParsedQuestion | null {
  if (!content) {
    return null;
  }

  const optionRegex =
    /(?:^|[\s\n])(?:[（(]\s*)?([A-D])(?:\s*[）)])?\s*[.、:：．]\s*/gi;

  const optionMatches = [...content.matchAll(optionRegex)];

  if (optionMatches.length < 2) {
    return null;
  }

  const firstOption = optionMatches[0];
  const firstOptionIndex = firstOption.index;

  if (firstOptionIndex === undefined) {
    return null;
  }

  const questionText = cleanQuestionText(
    content.substring(0, firstOptionIndex)
  );

  if (!questionText) {
    return null;
  }

  const options: string[] = [];

  for (let i = 0; i < optionMatches.length; i++) {
    const current = optionMatches[i];
    const start = (current.index ?? 0) + current[0].length;
    const next = optionMatches[i + 1];
    const end = next?.index ?? content.length;

    const optionText = cleanOptionText(
      content.substring(start, end)
    );

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

function cleanQuestionText(text: string): string {
  return text
    .replace(/^(?:第\s*)?\d{1,3}\s*[.、)．]\s*/, "")
    .replace(/===== PDF PAGE \d+ =====/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanOptionText(text: string): string {
  return text
    .replace(/===== PDF PAGE \d+ =====/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQuestionsInline(text: string): ParsedQuestion[] {
  const questionBlocks = text.split(
    /(?<!\d)(\d{1,3})\s*[.、)．]\s*(?=[^\d])/g
  );

  const questions: ParsedQuestion[] = [];

  for (let i = 1; i < questionBlocks.length; i += 2) {
    const questionNumber = Number(questionBlocks[i]);
    const content = questionBlocks[i + 1] ?? "";

    const question = parseQuestionContent(
      questionNumber,
      content
    );

    if (question) {
      questions.push(question);
    }
  }

  return questions.sort((a, b) => a.id - b.id);
}
