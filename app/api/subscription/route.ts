import { NextResponse } from "next/server";
import { getUserSubscription } from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  try {
    const result = await getUserSubscription(request.headers);
    if (!result) {
      return NextResponse.json(
        {
          loggedIn: false,
          user: null,
          subscription: null,
        },
        {
          status: 401,
          headers,
        }
      );
    }

    return NextResponse.json({
      loggedIn: true,
      ...result,
    }, { headers });
  } catch {
    console.error("Subscription API unavailable");

    return NextResponse.json(
      {
        error: "暫時無法取得會員資料，請稍後再試。",
      },
      {
        status: 503,
        headers,
      }
    );
  }
}
