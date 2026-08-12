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

    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json(
        {
          loggedIn: false,
          user: null,
          subscription: null,
        },
        {
          status: 401,
        }
      );
    }

    const sql = neon(databaseUrl);

    const subscriptions = await sql`
      SELECT
        id,
        user_id,
        plan,
        status,
        expires_at,
        created_at,
        updated_at
      FROM subscriptions
      WHERE user_id = ${session.user.id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const subscription = subscriptions[0] ?? null;

    return NextResponse.json({
      loggedIn: true,
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },
      subscription,
    });
  } catch (error) {
    console.error("Subscription API error:", error);

    return NextResponse.json(
      {
        error: "取得會員資料失敗",
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