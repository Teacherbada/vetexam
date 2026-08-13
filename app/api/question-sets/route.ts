import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return NextResponse.json({ error: "伺服器資料庫設定錯誤" }, { status: 500 });

    const sql = neon(databaseUrl);
    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id ?? null;

    const questionSets = userId
      ? await sql`
          SELECT id, name, filename, total_questions, created_at,
                 file_hash, visibility, owner_id, exam_subject, exam_year
          FROM question_sets
          WHERE visibility = 'public'
             OR (visibility = 'private' AND owner_id = ${userId})
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT id, name, filename, total_questions, created_at,
                 file_hash, visibility, owner_id, exam_subject, exam_year
          FROM question_sets
          WHERE visibility = 'public'
          ORDER BY created_at DESC
        `;

    return NextResponse.json({ success: true, questionSets });
  } catch (error) {
    console.error("Question sets API error:", error);
    return NextResponse.json({ error: "取得題庫失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return NextResponse.json({ error: "伺服器資料庫設定錯誤" }, { status: 500 });

    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "請先登入。" }, { status: 401 });

    const body = await request.json();
    const questions = Array.isArray(body?.questions) ? body.questions : [];
    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    const fileHash = typeof body?.fileHash === "string" ? body.fileHash.trim() : "";
    const examSubject = typeof body?.examSubject === "string" ? body.examSubject.trim() : "";
    const examYear = Number(body?.examYear);
    const visibility = body?.visibility === "public" ? "public" : "private";

    if (!questions.length) return NextResponse.json({ error: "沒有可以匯入的題目。" }, { status: 400 });
    if (!filename) return NextResponse.json({ error: "缺少 PDF 檔名。" }, { status: 400 });
    if (!examSubject) return NextResponse.json({ error: "缺少國考科目。" }, { status: 400 });
    if (!Number.isInteger(examYear) || examYear < 1990 || examYear > 2100) return NextResponse.json({ error: "國考年份無效。" }, { status: 400 });

    const isAdmin = !!process.env.ADMIN_USER_ID && process.env.ADMIN_USER_ID === userId;
    if (visibility === "public" && !isAdmin) {
      return NextResponse.json({ error: "目前只有管理員可以建立公開國考題庫。", code: "ADMIN_REQUIRED" }, { status: 403 });
    }

    const normalizedQuestions = questions.map((q: any, index: number) => {
      const options = Array.isArray(q?.options) ? q.options : [];
      return {
        number: index + 1,
        subject: examSubject,
        question: typeof q?.question === "string" ? q.question.trim() : "",
        optionA: typeof options[0] === "string" ? options[0].trim() : "",
        optionB: typeof options[1] === "string" ? options[1].trim() : "",
        optionC: typeof options[2] === "string" ? options[2].trim() : "",
        optionD: typeof options[3] === "string" ? options[3].trim() : "",
        answer: typeof q?.answer === "string" ? q.answer.trim() : "",
        explanation: typeof q?.explanation === "string" ? q.explanation.trim() : "",
      };
    });

    const invalid = normalizedQuestions.find(
      (q: {
        number: number;
        question: string;
        optionA: string;
        optionB: string;
        optionC: string;
        optionD: string;
      }) => !q.question || !q.optionA || !q.optionB || !q.optionC || !q.optionD
    );
    if (invalid) return NextResponse.json({ error: `第 ${invalid.number} 題資料不完整，請先檢查題目與四個選項。` }, { status: 400 });

    const sql = neon(databaseUrl);

    if (fileHash) {
      const existing = await sql`
        SELECT id, name, owner_id, visibility
        FROM question_sets
        WHERE file_hash = ${fileHash} AND owner_id = ${userId}
        LIMIT 1
      `;
      if (existing.length) {
        return NextResponse.json({ error: "這份 PDF 你已經匯入過了。", code: "DUPLICATE_FILE", questionSetId: Number(existing[0].id) }, { status: 409 });
      }
    }

    const name = `${examSubject} ${examYear - 1911} 年 · ${filename.replace(/\.pdf$/i, "")}`;
    const [setResult] = await sql.transaction([
      sql`
        INSERT INTO question_sets
          (name, filename, total_questions, file_hash, visibility, owner_id, exam_subject, exam_year)
        VALUES
          (${name}, ${filename}, ${normalizedQuestions.length}, ${fileHash || null}, ${visibility}, ${userId}, ${examSubject}, ${examYear})
        RETURNING id
      `,
    ]);

    const questionSetId = Number(setResult[0]?.id);
    if (!questionSetId) throw new Error("建立題庫失敗，沒有取得題庫 ID。");

    await sql.transaction(
      normalizedQuestions.map((q) => sql`
        INSERT INTO questions
          (question_set_id, question_number, subject, question, option_a, option_b, option_c, option_d, answer, explanation)
        VALUES
          (${questionSetId}, ${q.number}, ${q.subject}, ${q.question}, ${q.optionA}, ${q.optionB}, ${q.optionC}, ${q.optionD}, ${q.answer}, ${q.explanation})
      `)
    );

    return NextResponse.json({ success: true, questionSetId, totalQuestions: normalizedQuestions.length, message: `已確認匯入 ${normalizedQuestions.length} 題。` });
  } catch (error) {
    console.error("Create question set error:", error);
    return NextResponse.json({ error: "匯入題庫失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) return NextResponse.json({ error: "伺服器資料庫設定錯誤" }, { status: 500 });

    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;
    if (!userId) return NextResponse.json({ error: "請先登入。" }, { status: 401 });

    const body = await request.json();
    const questionSetId = Number(body?.questionSetId);
    if (!Number.isInteger(questionSetId) || questionSetId <= 0) return NextResponse.json({ error: "無效的題庫 ID。" }, { status: 400 });

    const sql = neon(databaseUrl);
    const sets = await sql`SELECT id, name, visibility, owner_id FROM question_sets WHERE id = ${questionSetId} LIMIT 1`;
    if (sets.length === 0) return NextResponse.json({ error: "找不到這個題庫。" }, { status: 404 });

    const questionSet = sets[0];
    const isAdmin = !!process.env.ADMIN_USER_ID && process.env.ADMIN_USER_ID === userId;
    const canDelete = questionSet.owner_id === userId || (isAdmin && questionSet.visibility === "public");
    if (!canDelete) return NextResponse.json({ error: "你沒有權限刪除這個題庫。" }, { status: 403 });

    await sql`DELETE FROM questions WHERE question_set_id = ${questionSetId}`;
    await sql`DELETE FROM question_sets WHERE id = ${questionSetId}`;

    return NextResponse.json({ success: true, message: `題庫「${questionSet.name}」已刪除。`, questionSetId });
  } catch (error) {
    console.error("Delete question set error:", error);
    return NextResponse.json({ error: "刪除題庫失敗", detail: error instanceof Error ? error.message : "未知錯誤" }, { status: 500 });
  }
}
