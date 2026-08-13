import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      return NextResponse.json(
        { error: "伺服器資料庫設定錯誤" },
        { status: 500 }
      );
    }

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
    return NextResponse.json(
      {
        error: "取得題庫失敗",
        detail: error instanceof Error ? error.message : "未知錯誤",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return NextResponse.json(
        { error: "伺服器資料庫設定錯誤" },
        { status: 500 }
      );
    }

    const session = await auth.api.getSession({ headers: request.headers });
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    }

    const body = await request.json();
    const questionSetId = Number(body?.questionSetId);

    if (!Number.isInteger(questionSetId) || questionSetId <= 0) {
      return NextResponse.json({ error: "無效的題庫 ID。" }, { status: 400 });
    }

    const sql = neon(databaseUrl);
    const sets = await sql`
      SELECT id, name, visibility, owner_id
      FROM question_sets
      WHERE id = ${questionSetId}
      LIMIT 1
    `;

    if (sets.length === 0) {
      return NextResponse.json({ error: "找不到這個題庫。" }, { status: 404 });
    }

    const questionSet = sets[0];
    const isAdmin =
      !!process.env.ADMIN_USER_ID &&
      process.env.ADMIN_USER_ID === userId;

    const canDelete =
      questionSet.owner_id === userId ||
      (isAdmin && questionSet.visibility === "public");

    if (!canDelete) {
      return NextResponse.json(
        { error: "你沒有權限刪除這個題庫。" },
        { status: 403 }
      );
    }

    // 先刪題目，再刪題庫，避免沒有 ON DELETE CASCADE 時留下孤兒資料。
    await sql`
      DELETE FROM questions
      WHERE question_set_id = ${questionSetId}
    `;

    await sql`
      DELETE FROM question_sets
      WHERE id = ${questionSetId}
    `;

    return NextResponse.json({
      success: true,
      message: `題庫「${questionSet.name}」已刪除。`,
      questionSetId,
    });
  } catch (error) {
    console.error("Delete question set error:", error);
    return NextResponse.json(
      {
        error: "刪除題庫失敗",
        detail: error instanceof Error ? error.message : "未知錯誤",
      },
      { status: 500 }
    );
  }
}
