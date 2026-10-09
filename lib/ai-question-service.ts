import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { parseAIBatch, parseAIQuestion, uuid, type AIQuestionInput, type AIPreview } from './ai-question-input';
import { QuestionAdminError, issuePreviewToken, checkPreviewToken } from './admin-questions';

type Query = (text: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const aiFingerprint = (q: AIQuestionInput) => hash([q.subject, q.question.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()]);
export async function previewAI(query: Query, input: unknown) {
  let batch: ReturnType<typeof parseAIBatch>;
  try { batch = parseAIBatch(input); } catch (e) { throw new QuestionAdminError((e as Error).message); }
  const fingerprints = batch.rows.filter(r => !r.errors.length).map(r => aiFingerprint(r.question!));
  const existing = await query('SELECT fingerprint FROM ai_questions WHERE fingerprint = ANY($1::text[])', [fingerprints]);
  const seen = new Set(existing.map(r => String(r.fingerprint)));
  for (const row of batch.rows) {
    if (row.errors.length) continue;
    const fingerprint = aiFingerprint(row.question!);
    if (seen.has(fingerprint)) row.errors.push('相同科目與題幹已存在（資料庫或本批次重複）');
    seen.add(fingerprint);
  }
  const preview: AIPreview = { rows: batch.rows, valid: batch.rows.filter(r => !r.errors.length).length, invalid: batch.rows.filter(r => r.errors.length).length };
  return { name: batch.name, preview, fingerprint: hash({ input, preview }) };
}
export async function signedAIPreview(query: Query, input: unknown, userId: string) {
  const result = await previewAI(query, input);
  return { ...result.preview, token: issuePreviewToken(result.fingerprint, userId) };
}
export async function importAI(client: PoolClient, body: Record<string, unknown>, userId: string) {
  if (!uuid(body.requestKey)) throw new QuestionAdminError('缺少有效的匯入識別碼');
  const requestHash = hash({ input: body.input, onlyValid: body.onlyValid === true });
  // Serialize rare admin writes, including submissions using different request keys.
  await client.query('LOCK TABLE ai_questions IN SHARE ROW EXCLUSIVE MODE');
  const previous = (await client.query('SELECT id,request_hash,created_by,result FROM ai_question_batches WHERE request_key=$1', [body.requestKey])).rows[0];
  if (previous) {
    if (previous.request_hash !== requestHash || previous.created_by !== userId) throw new QuestionAdminError('匯入識別碼已用於不同資料', 409);
    return { ...previous.result, replayed: true };
  }
  const result = await previewAI(async (sql, values) => (await client.query(sql, values)).rows, body.input);
  if (!checkPreviewToken(body.token, result.fingerprint, userId)) throw new QuestionAdminError('題庫已變更或預覽過期，請重新預覽', 409);
  if (!result.preview.valid || (result.preview.invalid && body.onlyValid !== true)) throw new QuestionAdminError('請修正錯誤，或明確勾選只匯入有效題目');
  const batchId = randomUUID();
  const summary = { batchId, imported: result.preview.valid, excluded: result.preview.rows.filter(r => r.errors.length).map(r => ({ index: r.index, errors: r.errors })), status: 'draft', reviewStatus: 'pending' };
  await client.query('INSERT INTO ai_question_batches(id,request_key,request_hash,name,created_by,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)', [batchId, body.requestKey, requestHash, result.name, userId, JSON.stringify(summary)]);
  const rows = result.preview.rows.filter(r => !r.errors.length).map(r => ({ id: randomUUID(), position: r.index, content: r.question, fingerprint: aiFingerprint(r.question!) }));
  await client.query('INSERT INTO ai_questions(id,batch_id,position,content,fingerprint) SELECT x.id,$1,x.position,x.content,x.fingerprint FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,position integer,content jsonb,fingerprint text)', [batchId, JSON.stringify(rows)]);
  return { ...summary, replayed: false };
}
export async function updateAI(client: PoolClient, body: Record<string, unknown>, userId: string) {
  if (!uuid(body.id) || !Number.isSafeInteger(body.revision) || !['save','publish','unpublish','delete'].includes(String(body.action))) throw new QuestionAdminError('題目、版本或操作無效');
  await client.query('LOCK TABLE ai_questions IN SHARE ROW EXCLUSIVE MODE');
  const row = (await client.query('SELECT * FROM ai_questions WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [body.id])).rows[0];
  if (!row) throw new QuestionAdminError('找不到題目', 404);
  if (row.revision !== body.revision) throw new QuestionAdminError('題目已由其他視窗更新，請重新載入', 409);
  if (body.action === 'save') {
    const parsed = parseAIQuestion(body.content);
    if (parsed.errors.length) throw new QuestionAdminError(parsed.errors.join('；'));
    await validateMaterialSource(client,String(body.id),parsed.question!,true);
    const fingerprint = aiFingerprint(parsed.question!);
    const duplicate = (await client.query('SELECT id FROM ai_questions WHERE fingerprint=$1 AND id<>$2', [fingerprint, body.id])).rows;
    if (duplicate.length) throw new QuestionAdminError('已有相同科目與題幹', 409);
    // Every saved edit requires fresh review, including source corrections.
    await client.query("UPDATE ai_questions SET content=$2::jsonb,fingerprint=$3,revision=revision+1,status='draft',review_status='pending',reviewed_by=NULL,reviewed_at=NULL,published_at=NULL,updated_at=now() WHERE id=$1", [body.id, JSON.stringify(parsed.question), fingerprint]);
  } else if (body.action === 'publish') {
    if (body.confirmReview !== true) throw new QuestionAdminError('請確認已人工核對題目、答案、解析與來源');
    const parsed = parseAIQuestion(row.content);
    if (parsed.errors.length) throw new QuestionAdminError(parsed.errors.join('；'));
    await validateMaterialSource(client,String(body.id),parsed.question!,false);
    await client.query("UPDATE ai_questions SET status='published',review_status='approved',reviewed_by=$2,reviewed_at=now(),published_at=now(),revision=revision+1,updated_at=now() WHERE id=$1", [body.id, userId]);
  } else if (body.action === 'delete') {
    if (row.status !== 'draft' || body.confirmDelete !== true) throw new QuestionAdminError('請先退回草稿，並確認刪除；既有作答紀錄會保留');
    await client.query('UPDATE ai_questions SET deleted_at=now(),revision=revision+1,updated_at=now() WHERE id=$1',[body.id]);
  } else {
    await client.query("UPDATE ai_questions SET status='draft',review_status='pending',reviewed_by=NULL,reviewed_at=NULL,published_at=NULL,revision=revision+1,updated_at=now() WHERE id=$1", [body.id]);
  }
  return (await client.query('SELECT * FROM ai_questions WHERE id=$1', [body.id])).rows[0];
}
async function validateMaterialSource(client: PoolClient, id: string, question: AIQuestionInput, update: boolean) {
  const provenance=(await client.query('SELECT s.material_id,m.pages,j.spec FROM ai_question_material_sources s JOIN ai_materials m ON m.id=s.material_id JOIN ai_questions q ON q.id=s.question_id JOIN ai_generation_jobs j ON j.batch_id=q.batch_id WHERE s.question_id=$1',[id])).rows[0];
  if (!provenance) return;
  const page=provenance.pages.find((p: {page:number})=>String(p.page)===question.source.pdfPages);
  const normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
  if (!page?.usable || page.page<provenance.spec.start || page.page>provenance.spec.end || question.source.excerpt.length<12 || !normalize(page.text).includes(normalize(question.source.excerpt)) || question.source.url) throw new QuestionAdminError('教材來源須為本批擷取頁次與原文摘錄；不可加入私人教材連結');
  if (update) await client.query('UPDATE ai_question_material_sources SET pdf_page=$2,page_hash=$3 WHERE question_id=$1',[id,page.page,page.hash]);
}
export async function publishAIBatch(client: PoolClient, body: Record<string,unknown>, userId: string) {
  if (body.confirmReview !== true || !Array.isArray(body.questions) || !body.questions.length || body.questions.length>200) throw new QuestionAdminError('請選擇已人工審核的題目（最多 200 題）');
  const ids=new Set<string>();
  for (const item of body.questions) {
    if (!item || !uuid(item.id) || ids.has(item.id)) throw new QuestionAdminError('批次題目無效或重複');
    ids.add(item.id);
    await updateAI(client,{action:'publish',id:item.id,revision:item.revision,confirmReview:true},userId);
  }
  return {published:ids.size};
}
export async function listPublishedAI(query: Query, subject: string, chapter: string, after: string) {
  return query("SELECT id,kind,revision,content->>'subject' AS subject,content->>'chapter' AS chapter,content->>'question' AS question,content->'options' AS options FROM ai_questions WHERE status='published' AND review_status='approved' AND deleted_at IS NULL AND ($1='' OR content->>'subject'=$1) AND ($2='' OR content->>'chapter'=$2) AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT 51", [subject, chapter, uuid(after) ? after : null]);
}
export async function answerAI(client: PoolClient, body: Record<string, unknown>, userId: string) {
  if (!uuid(body.id) || !uuid(body.requestKey) || !Number.isSafeInteger(body.revision) || typeof body.answer !== 'string' || !/^[A-D]$/.test(body.answer)) throw new QuestionAdminError('作答資料格式錯誤');
  // Share lock prevents withdrawal/edit between visibility check and recording.
  const row = (await client.query("SELECT * FROM ai_questions WHERE id=$1 AND status='published' AND review_status='approved' AND deleted_at IS NULL FOR SHARE", [body.id])).rows[0];
  if (!row) throw new QuestionAdminError('題目未發布或已撤回', 404);
  if (row.revision !== body.revision) throw new QuestionAdminError('題目版本已更新，請重新載入', 409);
  const content = row.content as AIQuestionInput;
  const attempt = (await client.query("INSERT INTO ai_question_attempts(id,user_id,request_key,question_id,revision,selected_answer,is_correct,content_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(user_id,request_key) DO UPDATE SET request_key=EXCLUDED.request_key RETURNING *",
    [randomUUID(), userId, body.requestKey, body.id, row.revision, body.answer, body.answer === content.answer, JSON.stringify(content)])).rows[0];
  if (attempt.question_id !== body.id || attempt.revision !== body.revision || attempt.selected_answer !== body.answer) throw new QuestionAdminError('作答識別碼已用於其他作答', 409);
  return { kind: 'ai', correct: attempt.is_correct, answer: content.answer, explanation: content.explanation, optionExplanations: content.optionExplanations, source: content.source, generationMethod: content.generationMethod };
}
