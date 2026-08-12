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
        {
          error: "伺服器資料庫設定錯誤",
        },
        {
          status: 500,
        }
      );
    }

    const sql = neon(databaseUrl);

    /*
     * 取得目前登入使用者
     *
     * 未登入：
     * → 只能看到公開題庫
     *
     * 已登入：
     * → 可以看到所有公開題庫
     * → 以及自己建立的私人題庫
     */
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    const userId = session?.user?.id ?? null;

    let questionSets;

    if (userId) {
      questionSets = await sql`
        SELECT
          id,
          name,
          filename,
          total_questions,
          created_at,
          file_hash,
          visibility,
          exam_subject,
          exam_year
        FROM question_sets
        WHERE
          visibility = 'public'
          OR (
            visibility = 'private'
            AND owner_id = ${userId}
          )
        ORDER BY created_at DESC
      `;
    } else {
      questionSets = await sql`
        SELECT
          id,
          name,
          filename,
          total_questions,
          created_at,
          file_hash,
          visibility,
          exam_subject,
          exam_year
        FROM question_sets
        WHERE visibility = 'public'
        ORDER BY created_at DESC
      `;
    }

    return NextResponse.json({
      success: true,
      questionSets,
    });
  } catch (error) {
    console.error(
      "Question sets API error:",
      error
    );

    return NextResponse.json(
      {
        error: "取得題庫失敗",
        detail:
          error instanceof Error
            ? error.message
            : "未知錯誤",
      },
      {
        status: 500,
      }
    );
  }
}