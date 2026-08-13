import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user?.id) {
    return NextResponse.json(
      {
        authenticated: false,
        isAdmin: false,
      },
      { status: 401 }
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
  });
}