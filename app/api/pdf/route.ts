import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";

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
      file.size,
      file.type
    );

    const arrayBuffer = await file.arrayBuffer();

    const uint8Array = new Uint8Array(arrayBuffer);

    console.log("PDF API: 開始解析 PDF");

    const parser = new PDFParse({
      data: uint8Array,
    });

    const result = await parser.getText();

    await parser.destroy();

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
  const normalized = normalizeText(text);

  const questionBlocks = normalized.split(
    /(?=\n?\s*\d+\s*[.、)．]\s+)/
  );

  const questions: ParsedQuestion[] = [];

  for (const block of questionBlocks) {
    const parsed = parseQuestionBlock(block);

    if (parsed) {
      questions.push(parsed);
    }
  }

  return questions;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseQuestionBlock(
  block: string
): ParsedQuestion | null {
  const questionMatch = block.match(
    /^\s*(\d+)\s*[.、)．]\s*([\s\S]+)$/
  );

  if (!questionMatch) {
    return null;
  }

  const questionNumber = Number(
    questionMatch[1]
  );

  const content = questionMatch[2].trim();

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
    const match = optionMatches[i];

    const optionLetter =
      match[1].toUpperCase();

    if (
      !["A", "B", "C", "D"].includes(
        optionLetter
      )
    ) {
      continue;
    }

    const start =
      (match.index ?? 0) +
      match[0].length;

    const nextMatch =
      optionMatches[i + 1];

    const end = nextMatch
      ? nextMatch.index ?? content.length
      : content.length;

    const optionText = content
      .substring(start, end)
      .replace(/\s+/g, " ")
      .trim();

    options.push(optionText);
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