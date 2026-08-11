import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

    const questionSets = await sql`
      SELECT
        id,
        name,
        filename,
        total_questions,
        created_at,
        file_hash
      FROM question_sets
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