import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PAGES = 200;

type ParsedQuestion = { id: number; subject: string; question: string; options: string[]; answer: string; explanation: string };

type Visibility = "public" | "private";

export async function POST(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return NextResponse.json({ error: "伺服器資料庫設定錯誤" }, { status: 500 });

    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return NextResponse.json({ error: "請先登入才能上傳 PDF。" }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get("file");
    const visibilityValue = formData.get("visibility");
    const examYearValue = formData.get("examYear") ?? formData.get("exam_year");
    const examSubjectValue = formData.get("examSubject") ?? formData.get("exam_subject");

    if (!(file instanceof File)) return NextResponse.json({ error: "沒有收到 PDF 檔案" }, { status: 400 });

    const examYear = normalizeExamYear(Number(examYearValue));
    if (!examYear) return NextResponse.json({ error: "請選擇有效的國考年份。" }, { status: 400 });

    const examSubject = typeof examSubjectValue === "string" ? examSubjectValue.trim() : "";
    if (!examSubject) return NextResponse.json({ error: "請選擇國考科目。" }, { status: 400 });

    let visibility: Visibility = "private";
    if (visibilityValue === "public") {
      if (!process.env.ADMIN_USER_ID || process.env.ADMIN_USER_ID !== session.user.id) {
        return NextResponse.json({ error: "目前只有管理員可以建立公開國考題庫。", code: "ADMIN_REQUIRED" }, { status: 403 });
      }
      visibility = "public";
    }

    const subscriptions = await (await import("@neondatabase/serverless")).neon(databaseUrl)`
      SELECT plan, status, expires_at FROM subscriptions WHERE user_id = ${session.user.id} LIMIT 1
    `;
    const subscription = subscriptions[0];
    const isPro = subscription?.plan === "pro" && subscription?.status === "active" &&
      (subscription?.expires_at == null || new Date(subscription.expires_at) > new Date());
    if (!isPro) return NextResponse.json({ error: "目前只有 PRO 會員可以上傳 PDF 題庫。", code: "PRO_REQUIRED" }, { status: 403 });

    if (file.type !== "application/pdf") return NextResponse.json({ error: "目前只接受 PDF 檔案" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "PDF 檔案是空的" }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "PDF 檔案太大", detail: "目前單一 PDF 最大限制為 10 MB。" }, { status: 413 });

    const pdfBytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(pdfBytes).digest("hex");
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;

    if (pdf.numPages > MAX_PAGES) return NextResponse.json({ error: "PDF 頁數太多", detail: `目前單一 PDF 最大限制為 ${MAX_PAGES} 頁。` }, { status: 413 });

    let fullText = "";
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const items = textContent.items.filter((item: any) => typeof item.str === "string" && item.str.trim() !== "").map((item: any) => ({
        text: item.str.trim(), x: Number(item.transform?.[4] ?? 0), y: Number(item.transform?.[5] ?? 0), width: Number(item.width ?? 0),
      })).sort((a, b) => Math.abs(a.y - b.y) <= 3 ? a.x - b.x : b.y - a.y);

      const lines: Array<{ y: number; items: Array<{ text: string; x: number; width: number }> }> = [];
      for (const item of items) {
        const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= 3);
        if (line) { line.items.push(item); line.items.sort((a, b) => a.x - b.x); }
        else lines.push({ y: item.y, items: [{ text: item.text, x: item.x, width: item.width }] });
      }
      lines.sort((a, b) => b.y - a.y);
      const pageText = lines.map((line) => {
        let result = ""; let previousEnd = -Infinity;
        for (const item of line.items) {
          const separator = result && item.x - previousEnd > 2 ? " " : "";
          result += separator + item.text; previousEnd = item.x + item.width;
        }
        return result.trim();
      }).filter(Boolean).join("\n");
      fullText += `\n===== PDF PAGE ${pageNumber} =====\n${pageText}\n`;
    }

    const text = fullText.trim();
    if (!text) return NextResponse.json({ error: "PDF 有成功讀取，但沒有偵測到文字。目前尚未支援純掃描圖片型 PDF OCR。" }, { status: 400 });

    const questions = parseQuestions(text);
    if (questions.length === 0) return NextResponse.json({ error: "沒有辨識到選擇題。請確認 PDF 題目格式。", textPreview: text.substring(0, 5000) }, { status: 400 });

    // 重要：這裡只解析，不寫入 Neon。使用者檢查後才會呼叫 /api/pdf/confirm。
    return NextResponse.json({
      success: true,
      pendingConfirmation: true,
      message: `成功辨識 ${questions.length} 題，尚未寫入資料庫。請檢查後按「確認並開始刷題」。`,
      fileHash,
      filename: file.name,
      visibility,
      examYear,
      examSubject,
      total: questions.length,
      questions,
      textLength: text.length,
      totalPages: pdf.numPages,
    });
  } catch (error) {
    console.error("PDF parsing error:", error);
    return NextResponse.json({ error: "PDF 解析失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}

function normalizeExamYear(value: number) {
  if (!Number.isInteger(value)) return null;
  const year = value >= 80 && value <= 200 ? value + 1911 : value;
  return year >= 1990 && year <= 2100 ? year : null;
}

function parseQuestions(text: string): ParsedQuestion[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/===== PDF PAGE \d+ =====/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  // 題號必須位於「真正的一行開頭」，避免把 16%、年份、選項內數字誤判成新題目。
  const questionStartRegex = /^\s*(\d{1,3})\s*[.、)．]\s+/gm;
  const matches = [...normalized.matchAll(questionStartRegex)];
  const questions: ParsedQuestion[] = [];

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const number = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? normalized.length;
    const parsed = parseQuestionContent(number, normalized.substring(start, end).trim());
    if (parsed) questions.push(parsed);
  }

  const unique = new Map<number, ParsedQuestion>();
  for (const question of questions) if (!unique.has(question.id)) unique.set(question.id, question);
  return [...unique.values()].sort((a, b) => a.id - b.id);
}

function parseQuestionContent(questionNumber: number, content: string): ParsedQuestion | null {
  if (!content) return null;
  // 選項也要求在行首，避免把題幹中的 A. / B. 或百分比誤判。
  const optionRegex = /^\s*(?:[（(]\s*)?([A-D])(?:\s*[）)])?\s*[.、:：．]\s+/gim;
  const optionMatches = [...content.matchAll(optionRegex)];
  if (optionMatches.length < 2) return null;

  const firstIndex = optionMatches[0].index;
  if (firstIndex == null) return null;
  const questionText = clean(content.substring(0, firstIndex));
  if (!questionText || questionText.length < 4) return null;

  const options: string[] = [];
  for (let i = 0; i < optionMatches.length; i++) {
    const start = (optionMatches[i].index ?? 0) + optionMatches[i][0].length;
    const end = optionMatches[i + 1]?.index ?? content.length;
    options.push(clean(content.substring(start, end)));
  }
  if (options.filter(Boolean).length < 2) return null;
  while (options.length < 4) options.push("");

  return { id: questionNumber, subject: "PDF 題庫", question: questionText, options: options.slice(0, 4), answer: "", explanation: "" };
}

function clean(value: string) { return value.replace(/===== PDF PAGE \d+ =====/g, "").replace(/\s+/g, " ").trim(); }
