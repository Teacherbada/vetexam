import { NextResponse } from "next/server";
import { questionTransaction } from "@/lib/question-transaction";
import { auth } from "@/lib/auth";
import { parseAnswerSubmissions, recordFirstAnswers } from "@/lib/question-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "不允許此來源" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "請使用 JSON 格式" }, { status: 415 });
  }
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return NextResponse.json({ success: true, recorded: false });
    // Bound the stream, including chunked requests without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "缺少答題資料" }, { status: 400 });
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return NextResponse.json({ error: "答題資料過大" }, { status: 413 }); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return NextResponse.json({ error: "答題資料格式錯誤" }, { status: 400 }); }
    const answers = parseAnswerSubmissions(body);
    if (!answers) return NextResponse.json({ error: "答題資料格式錯誤" }, { status: 400 });
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("Missing database configuration");
    await questionTransaction(async client => {
      // Acquire the writer lock before the INSERT statement takes its snapshot.
      // Admin corrections hold a conflicting lock through answer + stats updates.
      await client.query('LOCK TABLE question_answer_stats IN ROW EXCLUSIVE MODE');
      await recordFirstAnswers(async (text, values) => (await client.query(text, values)).rows, session.user.id, answers);
    });
    // Never return correctness, the answer key, or per-user records.
    return NextResponse.json({ success: true });
  } catch {
    console.error("Answer statistics write failed");
    return NextResponse.json({ error: "統計暫時無法儲存" }, { status: 503 });
  }
}
