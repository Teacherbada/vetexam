import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";

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

    console.log(
      "PDF API: 收到檔案",
      file.name,
      file.size
    );

    const arrayBuffer = await file.arrayBuffer();

    const pdfData = new Uint8Array(arrayBuffer);

    console.log("PDF API: 開始載入 PDF");

    const pdf = await getDocumentProxy(pdfData);

    console.log(
      "PDF API: PDF 頁數",
      pdf.numPages
    );

    const result = await extractText(pdf, {
      mergePages: true,
    });

    const text = result.text || "";

    console.log(
      "PDF API: 取得文字長度",
      text.length
    );

    if (!text.trim()) {
      return NextResponse.json(
        {
          error:
            "PDF 有成功讀取，但沒有偵測到文字。這可能是一份掃描圖片型 PDF，目前尚未支援 OCR。",
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

    return NextResponse.json({
      success: true,
      total: questions.length,
      questions,
      textLength: text.length,
      totalPages: result.totalPages,
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
    /(?:^|\n|\s)(?:\(?|\（?)([A-D])(?:\)|）)?\s*[.、:：)．]\s*/gi;

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