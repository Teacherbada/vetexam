import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParsedQuestion = {
  id: number;
  subject: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
};

export async function POST(request: Request) {
  try {
    console.log("PDF API: 開始接收檔案");

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "沒有收到 PDF 檔案" },
        { status: 400 }
      );
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

    console.log("PDF API: 收到檔案", file.name, file.size);

    const arrayBuffer = await file.arrayBuffer();

    /*
     * PDF.js
     *
     * 使用 legacy build，適合 Node.js / Vercel Serverless。
     *
     * 不使用 disableWorker。
     *
     * worker 的檔案會透過 next.config.ts
     * 的 outputFileTracingIncludes 一起部署到 Vercel。
     */
    const pdfjsLib = await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );

    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
    });

    const pdf = await loadingTask.promise;

    console.log("PDF API: PDF 頁數", pdf.numPages);

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

    return NextResponse.json({
      success: true,
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
    const question = parseQuestionBlock(block);

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
    /(?:^|\n|\s)(?:\(?([A-D])(?:\)|）)?\s*)?[.、:：)．]\s*/gi;

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

  for (let i = 0; i < optionMatches.length; i++) {
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