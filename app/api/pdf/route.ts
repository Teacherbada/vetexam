import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 動態載入，避免 Next.js build 階段直接載入 pdf-parse
    const pdfModule = await import("pdf-parse");

    const pdf = pdfModule.default;

    const result = await pdf(buffer);

    const questions = parseQuestions(result.text);

    return NextResponse.json({
      success: true,
      questions,
    });
  } catch (error) {
    console.error("PDF parsing error:", error);

    return NextResponse.json(
      {
        error: "PDF 解析失敗",
      },
      {
        status: 500,
      }
    );
  }
}

function parseQuestions(text: string) {
  const normalized = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  const blocks = normalized.split(
    /(?=\n?\s*\d+\s*[.、)]\s*)/
  );

  const questions: any[] = [];

  for (const block of blocks) {
    const match = block.match(
      /^\s*(\d+)\s*[.、)]\s*([\s\S]+)/
    );

    if (!match) {
      continue;
    }

    const questionNumber = Number(match[1]);
    const content = match[2].trim();

    const optionMatches = [
      ...content.matchAll(
        /(?:^|\n|\s)([A-D])\s*[.、):：]\s*([\s\S]*?)(?=\s+[A-D]\s*[.、):：]|$)/g
      ),
    ];

    if (optionMatches.length < 2) {
      continue;
    }

    const firstOptionIndex = content.search(
      /(?:^|\s)A\s*[.、):：]\s*/
    );

    if (firstOptionIndex === -1) {
      continue;
    }

    const questionText = content
      .substring(0, firstOptionIndex)
      .trim();

    const options = optionMatches.map(
      (match) =>
        match[2]
          .replace(/\s+/g, " ")
          .trim()
    );

    questions.push({
      id: questionNumber,
      subject: "PDF 題庫",
      question: questionText,
      options,
      answer: "",
      explanation: "",
    });
  }

  return questions;
}