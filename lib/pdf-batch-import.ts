import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { validateImportRanges, type ImportBatch, type ImportQuestion } from "./import-batches";

export class ImportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function parseImportBatch(value: unknown): ImportBatch {
  if (!value || typeof value !== "object") throw new ImportError("缺少匯入資料。");
  const body = value as ImportBatch;
  if (typeof body.importId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.importId) ||
    typeof body.filename !== "string" || !body.filename.trim() || body.filename.length > 255 ||
    typeof body.fileHash !== "string" || !/^[0-9a-f]{64}$/i.test(body.fileHash) ||
    typeof body.examSubject !== "string" || !body.examSubject.trim() || body.examSubject.length > 100 ||
    !Number.isInteger(body.examYear) || body.examYear < 1990 || body.examYear > 2100 ||
    !["public", "private"].includes(body.visibility) || !Array.isArray(body.ranges) || !Array.isArray(body.questions)) throw new ImportError("匯入設定格式錯誤。");
  try { validateImportRanges(body.ranges, body.totalQuestions); }
  catch (error) { throw new ImportError((error as Error).message); }
  if (!Number.isInteger(body.batchIndex) || body.batchIndex < 0 || body.batchIndex >= body.ranges.length) throw new ImportError("批次編號錯誤。");
  const range = body.ranges[body.batchIndex];
  if (body.questions.length !== range.to - range.from + 1) throw new ImportError("批次題數與範圍不符。");
  const questions: ImportQuestion[] = body.questions.map((question, index) => {
    if (!question || typeof question.question !== "string" || !question.question.trim() ||
      !Array.isArray(question.options) || question.options.length < 4 || question.options.length > 5 || question.options.some((option) => typeof option !== "string" || !option.trim()) ||
      typeof question.answer !== "string" || !/^[A-E]?$/.test(question.answer) || typeof question.explanation !== "string" ||
      (question.imageDataUrl != null && (typeof question.imageDataUrl !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/i.test(question.imageDataUrl)))) throw new ImportError(`第 ${range.from + index} 題資料不完整或圖片格式錯誤。`);
    return { question: question.question.trim(), options: question.options.map((option) => option.trim()), answer: question.answer, explanation: question.explanation, imageDataUrl: question.imageDataUrl || null };
  });
  return { importId: body.importId, filename: body.filename.trim(), fileHash: body.fileHash.toLowerCase(), visibility: body.visibility,
    examSubject: body.examSubject.trim(), examYear: body.examYear, totalQuestions: body.totalQuestions,
    ranges: body.ranges.map(({ from, to }) => ({ from, to })), batchIndex: body.batchIndex, questions };
}

/** Caller owns transaction. A row lock serializes retries and finalization. */
export async function saveImportBatch(client: Pick<PoolClient, "query">, userId: string, isAdmin: boolean, input: ImportBatch) {
  if (input.visibility === "public" && !isAdmin) throw new ImportError("目前只有管理員可以建立公開國考題庫。", 403);
  const { importId, batchIndex, questions, ...metadata } = input;
  const payload = JSON.stringify(questions);
  const hash = createHash("sha256").update(payload).digest("hex");
  // Reclaim only this owner's abandoned staging payloads, never real questions.
  await client.query("DELETE FROM pdf_batch_imports WHERE owner_id=$1 AND completed_at IS NULL AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days'", [userId]);
  await client.query("INSERT INTO pdf_batch_imports(id,owner_id,metadata) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING", [importId, userId, JSON.stringify(metadata)]);
  const job = (await client.query("SELECT * FROM pdf_batch_imports WHERE id=$1 FOR UPDATE", [importId])).rows[0];
  if (job.owner_id !== userId) throw new ImportError("無法存取此匯入工作。", 403);
  const sameMetadata = (await client.query("SELECT metadata=$2::jsonb AS same FROM pdf_batch_imports WHERE id=$1", [importId, JSON.stringify(metadata)])).rows[0].same;
  if (!sameMetadata) throw new ImportError("批次設定已改變，請重新開始分批匯入。", 409);
  const previous = (await client.query("SELECT payload_hash FROM pdf_import_chunks WHERE import_id=$1 AND batch_index=$2", [importId, batchIndex])).rows[0];
  if (previous && previous.payload_hash !== hash) throw new ImportError("這批內容與已收到的資料不同，請重新開始分批匯入。", 409);
  if (job.completed_at) {
    if (!job.question_set_id) throw new ImportError("此題庫已刪除，請重新開始匯入。", 409);
    return { success: true, complete: true, questionSetId: Number(job.question_set_id) };
  }
  if (!previous) await client.query("INSERT INTO pdf_import_chunks(import_id,batch_index,payload_hash,questions) VALUES($1,$2,$3,$4::jsonb)", [importId, batchIndex, hash, payload]);
  const count = Number((await client.query("SELECT COUNT(*) AS count FROM pdf_import_chunks WHERE import_id=$1", [importId])).rows[0].count);
  if (count !== input.ranges.length) return { success: true, complete: false, receivedBatches: count };
  const existing = (await client.query("SELECT id FROM question_sets WHERE file_hash=$1 AND (visibility=$2 OR (visibility='public' AND $3=false)) LIMIT 1", [input.fileHash, input.visibility, isAdmin])).rows[0];
  if (existing) throw new ImportError("這份 PDF 已經存在於題庫，不需要再次匯入。", 409);
  const name = `${input.examSubject} ${input.examYear - 1911} 年 · ${input.filename.replace(/\.pdf$/i, "")}`;
  const questionSetId = Number((await client.query("INSERT INTO question_sets(name,filename,total_questions,file_hash,visibility,owner_id,exam_subject,exam_year) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [name, input.filename, input.totalQuestions, input.fileHash, input.visibility, userId, input.examSubject, input.examYear])).rows[0].id);
  await client.query(`INSERT INTO questions(question_set_id,question_number,subject,question,option_a,option_b,option_c,option_d,option_e,answer,explanation,image_data_url)
    SELECT $2, (j.metadata->'ranges'->c.batch_index->>'from')::int + q.ordinality::int - 1,
      $3, q.value->>'question', q.value->'options'->>0, q.value->'options'->>1, q.value->'options'->>2, q.value->'options'->>3,
      COALESCE(q.value->'options'->>4,''), q.value->>'answer', q.value->>'explanation', q.value->>'imageDataUrl'
    FROM pdf_import_chunks c JOIN pdf_batch_imports j ON j.id=c.import_id
    CROSS JOIN LATERAL jsonb_array_elements(c.questions) WITH ORDINALITY q(value,ordinality)
    WHERE c.import_id=$1 ORDER BY c.batch_index,q.ordinality`, [importId, questionSetId, input.examSubject]);
  await client.query("UPDATE pdf_batch_imports SET question_set_id=$2,completed_at=CURRENT_TIMESTAMP WHERE id=$1", [importId, questionSetId]);
  await client.query("UPDATE pdf_import_chunks SET questions=NULL WHERE import_id=$1", [importId]);
  return { success: true, complete: true, questionSetId, message: `已分批匯入 ${input.totalQuestions} 題到同一份題庫。` };
}
