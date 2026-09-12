import { NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { IMPORT_BATCH_LIMIT } from "@/lib/import-batches";
import { ImportError, parseImportBatch, saveImportBatch } from "@/lib/pdf-batch-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000 });

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return NextResponse.json({ error: "請先登入。" }, { status: 401 });
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new ImportError("不允許此來源。", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ImportError("請使用 JSON 格式。", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new ImportError("缺少匯入資料。");
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > IMPORT_BATCH_LIMIT) { await reader.cancel(); throw new ImportError("本批超過 4 MB，請縮小題號範圍或圖片。", 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ImportError("匯入資料不是有效 JSON。"); }
    const input = parseImportBatch(body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout='30s'");
      await client.query("SET LOCAL lock_timeout='10s'");
      const result = await saveImportBatch(client, session.user.id, process.env.ADMIN_USER_ID === session.user.id, input);
      await client.query("COMMIT");
      return NextResponse.json(result);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) {
    if (error instanceof ImportError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return NextResponse.json({ error: "這份 PDF 已經存在於題庫。" }, { status: 409 });
    console.error("PDF batch import failed");
    return NextResponse.json({ error: "分批匯入暫時失敗，已收到的批次會保留，請重試。" }, { status: 500 });
  }
}
