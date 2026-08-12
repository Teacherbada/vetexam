import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user?.id) {
      return NextResponse.json({
        loggedIn: false,
        session: null,
      });
    }

    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      return NextResponse.json(
        {
          error: "DATABASE_URL 不存在",
        },
        { status: 500 }
      );
    }

    const sql = neon(databaseUrl);

    const userId = session.user.id;

    const subscriptions = await sql`
      SELECT
        *
      FROM subscriptions
      WHERE user_id = ${userId}
      ORDER BY expires_at DESC NULLS LAST
    `;

    return NextResponse.json({
      loggedIn: true,

      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      },

      subscriptions,
    });
  } catch (error) {
    console.error("DEBUG SESSION ERROR:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "未知錯誤",
      },
      { status: 500 }
    );
  }
}