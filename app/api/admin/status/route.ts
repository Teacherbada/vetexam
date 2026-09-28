import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logAuthEvent } from "@/lib/auth-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user?.id) {
      logAuthEvent(session ? 'USER_FETCH_FAILED' : 'AUTH_SESSION_MISSING', request.headers, 'admin.session', 401);
      return NextResponse.json(
        {
          authenticated: false,
          isAdmin: false,
        },
        { status: 401, headers }
      );
    }

    const adminUserId =
      process.env.ADMIN_USER_ID?.trim();

    const isAdmin =
      Boolean(adminUserId) &&
      session.user.id === adminUserId;

    return NextResponse.json({
      authenticated: true,
      isAdmin,
    }, { headers });
  } catch {
    logAuthEvent('AUTH_SESSION_FETCH_FAILED', request.headers, 'admin.session', 503);
    return NextResponse.json({ error: '暫時無法確認帳號，請稍後再試。' }, { status: 503, headers });
  }
}
