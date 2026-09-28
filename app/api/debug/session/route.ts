import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";
import { logAuthEvent } from "@/lib/auth-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  let stage: 'session' | 'subscription' = 'session';
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user?.id) {
      logAuthEvent(session ? 'USER_FETCH_FAILED' : 'AUTH_SESSION_MISSING', request.headers, 'debug.session');
      return NextResponse.json({
        loggedIn: false,
        session: null,
      }, { headers });
    }

    stage = 'subscription';
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      logAuthEvent('SUBSCRIPTION_FETCH_FAILED', request.headers, 'debug.subscription', 500);
      return NextResponse.json(
        {
          error: "DATABASE_URL 不存在",
          loggedIn: true,
        },
        { status: 500, headers }
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
    }, { headers });
  } catch {
    logAuthEvent(stage === 'session' ? 'AUTH_SESSION_FETCH_FAILED' : 'SUBSCRIPTION_FETCH_FAILED', request.headers, `debug.${stage}`, 500);

    return NextResponse.json(
      {
        error: "暫時無法取得診斷資料，請稍後再試。",
        ...(stage === 'subscription' ? { loggedIn: true } : {}),
      },
      { status: 500, headers }
    );
  }
}
