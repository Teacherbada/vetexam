import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { questionTransaction } from "@/lib/question-transaction";
import { DiagnosticError } from "@/lib/diagnostic-service";
import { answerReinforcement, changeReinforcement, readReinforcement, startReinforcement } from "@/lib/reinforcement-service";
import { parseDiagnosticAnswer } from "@/lib/diagnostic";
import { parseReinforcementCommand, validTaskId } from "@/lib/reinforcement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}
async function handle(request: Request, action: "read" | "start" | "change" | "answer") {
  try {
    if (action !== "read") {
      const origin = request.headers.get("origin");
      if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "不允許此來源" }, 403);
    }
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return json({ error: "請先登入後使用補強任務。" }, 401);
    const userId = session.user.id;
    if (action === "read") return json(await questionTransaction(client => readReinforcement(client, userId)));
    if (action === "start") return json(await questionTransaction(client => startReinforcement(client, userId)));
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "請使用 JSON 格式" }, 415);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "缺少任務資料" }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return json({ error: "任務資料過大" }, 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return json({ error: "任務資料格式錯誤" }, 400); }
    if (action === "change") {
      const command = parseReinforcementCommand(body);
      if (!command) return json({ error: "任務資料格式錯誤" }, 400);
      return json(await questionTransaction(client => changeReinforcement(client, userId, command)));
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: "作答資料格式錯誤" }, 400);
    const { taskId, ...answer } = body as Record<string, unknown>;
    const submission = parseDiagnosticAnswer(answer);
    if (!validTaskId(taskId) || !submission) return json({ error: "作答資料格式錯誤" }, 400);
    return json(await questionTransaction(client => answerReinforcement(client, userId, taskId, submission)));
  } catch (error) {
    if (error instanceof DiagnosticError) return json({ error: error.message }, error.status);
    return json({ error: "補強任務暫時無法連線。請重新載入確認已儲存進度。" }, 503);
  }
}
export async function GET(request: Request) { return handle(request, "read"); }
export async function POST(request: Request) { return handle(request, "start"); }
export async function PATCH(request: Request) { return handle(request, "change"); }
export async function PUT(request: Request) { return handle(request, "answer"); }
