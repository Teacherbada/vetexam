import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      console.error("DATABASE_URL not found");

      return NextResponse.json(
        { error: "伺服器資料庫設定錯誤" },
        { status: 500 }
      );
    }

    const sql = neon(databaseUrl);

    /*
     * 取得目前登入狀態
     *
     * 未登入也可以使用公開題庫，
     * 所以這裡不直接擋掉未登入使用者。
     */
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    const userId = session?.user?.id ?? null;

    /*
     * 公開題庫：
     * 所有人都可以看到
     *
     * 私人題庫：
     * 只有建立者本人可以看到
     */
    const questionSets = userId
      ? await sql`
          SELECT
            id,
            name,
            filename,
            total_questions,
            created_at,
            file_hash,
            visibility,
            owner_id
          FROM question_sets
          WHERE
            visibility = 'public'
            OR owner_id = ${userId}
          ORDER BY created_at DESC
        `
      : await sql`
          SELECT
            id,
            name,
            filename,
            total_questions,
            created_at,
            file_hash,
            visibility,
            owner_id
          FROM question_sets
          WHERE visibility = 'public'
          ORDER BY created_at DESC
        `;

    return NextResponse.json({
      success: true,
      questionSets,
    });
  } catch (error) {
    console.error("Question sets API error:", error);

    return NextResponse.json(
      {
        error: "無法取得題庫",
        detail:
          error instanceof Error
            ? error.message
            : "未知錯誤",
      },
      { status: 500 }
    );
  }
}