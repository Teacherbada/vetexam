import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Question = { id: number; question: string; options?: string[]; answer?: string; explanation?: string };

export async function POST(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return NextResponse.json({ error: "伺服器資料庫設定錯誤" }, { status: 500 });

    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "請先登入。" }, { status: 401 });

    const body = await request.json();
    const fileHash = typeof body?.fileHash === "string" ? body.fileHash.trim() : "";
    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    const examSubject = typeof body?.examSubject === "string" ? body.examSubject.trim() : "";
    const examYear = Number(body?.examYear);
    const visibility = body?.visibility === "public" ? "public" : "private";
    const questions = Array.isArray(body?.questions) ? body.questions as Question[] : [];

    if (!fileHash || !filename || !examSubject || !Number.isInteger(examYear) || questions.length === 0) {
      return NextResponse.json({ error: "確認資料不完整，無法保存題庫。" }, { status: 400 });
    }

    if (visibility === "public" && process.env.ADMIN_USER_ID !== userId) {
      return NextResponse.json({ error: "只有管理員可以建立公開國考題庫。", code: "ADMIN_REQUIRED" }, { status: 403 });
    }

    const sql = neon(databaseUrl);

    // 二次檢查重複，避免使用者連按確認或同一份 PDF 重複建立。
    const existing = await sql`
      SELECT id, visibility, owner_id FROM question_sets
      WHERE file_hash = ${fileHash} AND owner_id = ${userId}
      LIMIT 1
    `;
    if (existing.length) {
      return NextResponse.json({ success: true, duplicate: true, questionSetId: Number(existing[0].id), message: "這份 PDF 已經匯入過。" });
    }

    if (visibility === "public") {
      const publicExisting = await sql`
        SELECT id FROM question_sets WHERE file_hash = ${fileHash} AND visibility = 'public' LIMIT 1
      `;
      if (publicExisting.length) {
        return NextResponse.json({ success: true, duplicate: true, questionSetId: Number(publicExisting[0].id), message: "這份 PDF 已存在公開題庫。" });
      }
    }

    const setName = filename.replace(/\.pdf$/i, "").trim() || `${examYear} 年 ${examSubject}`;
    const inserted = await sql`
      INSERT INTO question_sets (name, filename, file_hash, total_questions, visibility, owner_id, exam_year, exam_subject)
      VALUES (${setName}, ${filename}, ${fileHash}, ${questions.length}, ${visibility}, ${userId}, ${examYear}, ${examSubject})
      RETURNING id
    `;
    const questionSetId = Number(inserted[0].id);

    for (const question of questions) {
      const options = Array.isArray(question.options) ? question.options : [];
      await sql`
        INSERT INTO questions (question_set_id, question_number, subject, question, option_a, option_b, option_c, option_d, answer, explanation)
        VALUES (
          ${questionSetId}, ${Number(question.id)}, ${examSubject}, ${question.question ?? ""},
          ${options[0] ?? ""}, ${options[1] ?? ""}, ${options[2] ?? ""}, ${options[3] ?? ""},
          ${question.answer ?? ""}, ${question.explanation ?? ""}
        )
      `;
    }

    return NextResponse.json({ success: true, duplicate: false, questionSetId, total: questions.length, message: "題目確認完成，已正式保存到資料庫。" });
  } catch (error) {
    console.error("PDF confirm error:", error);
    return NextResponse.json({ error: "保存題庫失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}
