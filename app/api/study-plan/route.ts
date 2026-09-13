import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { auth } from "@/lib/auth";
import { parseStudyMode } from "@/lib/study-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return json({ error: "請先登入後儲存學習模式" }, 401);
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`SELECT mode FROM study_plans WHERE user_id = ${session.user.id}`;
    return json({ mode: rows[0]?.mode ?? null });
  } catch {
    return json({ error: "學習模式暫時無法讀取，請稍後再試。" }, 503);
  }
}

export async function PUT(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return json({ error: "不允許此來源" }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return json({ error: "請使用 JSON 格式" }, 415);
  }
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return json({ error: "請先登入後儲存學習模式" }, 401);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "請選擇學習模式" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return json({ error: "資料過大" }, 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return json({ error: "資料格式錯誤" }, 400); }
    const mode = parseStudyMode(body);
    if (!mode) return json({ error: "請選擇有效的學習模式" }, 400);
    const sql = neon(process.env.DATABASE_URL!);
    const rows = await sql`
      INSERT INTO study_plans (user_id, mode) VALUES (${session.user.id}, ${mode})
      ON CONFLICT (user_id) DO UPDATE SET mode = EXCLUDED.mode, updated_at = CURRENT_TIMESTAMP
      RETURNING mode
    `;
    return json({ mode: rows[0].mode });
  } catch {
    return json({ error: "學習模式暫時無法儲存，請重試確認目前模式。" }, 503);
  }
}
