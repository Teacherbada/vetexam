import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { questionTransaction } from './question-transaction';
import { QuestionAdminError } from './admin-questions';
import { uuid } from './ai-question-input';
import { aiFingerprint } from './ai-question-service';
import { MATERIAL_LIMITS, parseMaterialSpec, generatedQuestion, type MaterialPage, type MaterialSpec } from './ai-material-input';
import { materialModelRequest, callMaterialModel } from './ai-material-model';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function saveMaterial(client: PoolClient, bytes: Buffer, filename: string, pages: MaterialPage[], userId: string) {
  const fingerprint = createHash('sha256').update(bytes).digest('hex');
  return (await client.query('INSERT INTO ai_materials(id,fingerprint,filename,pdf,pages,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id,filename,pages',
    [randomUUID(),fingerprint,filename.slice(0,200),bytes,JSON.stringify(pages),userId])).rows[0];
}
export async function estimateMaterial(client: PoolClient, input: unknown) {
  const id = (input as {materialId?:unknown})?.materialId;
  if (!uuid(id)) throw new QuestionAdminError('教材識別碼無效');
  const material = (await client.query('SELECT id,pages FROM ai_materials WHERE id=$1',[id])).rows[0];
  if (!material) throw new QuestionAdminError('找不到教材',404);
  let spec: MaterialSpec;
  try { spec = parseMaterialSpec(input,material.pages); materialModelRequest(spec,material.pages,[],1); }
  catch(e) { throw new QuestionAdminError((e as Error).message); }
  const cost = spec.count*MATERIAL_LIMITS.perQuestionMicroUSD;
  if (cost > MATERIAL_LIMITS.batchMicroUSD) throw new QuestionAdminError('超過每批費用限制');
  return {spec,pages:material.pages as MaterialPage[],cost};
}
export async function startMaterialJob(client: PoolClient, body: Record<string,unknown>, userId: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new QuestionAdminError('尚未設定 OPENAI_API_KEY；尚未完成真實生成驗證',503);
  if (!uuid(body.requestKey) || body.confirmText !== true || body.confirmCost !== true) throw new QuestionAdminError('請先確認擷取文字、圖表限制及費用');
  const {spec,cost} = await estimateMaterial(client,body.spec);
  if (body.estimateMicroUSD !== cost) throw new QuestionAdminError('費用預估已變更，請重新確認',409);
  const fingerprint = hash({spec,model:MATERIAL_LIMITS.model,promptVersion:1});
  await client.query('LOCK TABLE ai_generation_jobs IN SHARE ROW EXCLUSIVE MODE');
  const priorKey = (await client.query('SELECT id,fingerprint FROM ai_generation_jobs WHERE request_key=$1',[body.requestKey])).rows[0];
  if (priorKey && priorKey.fingerprint !== fingerprint) throw new QuestionAdminError('生成識別碼已用於其他設定',409);
  const prior = (await client.query('SELECT id,batch_id FROM ai_generation_jobs WHERE fingerprint=$1',[fingerprint])).rows[0];
  if (prior) return {jobId:prior.id,batchId:prior.batch_id,replayed:true};
  const reserved = Number((await client.query("SELECT COALESCE(SUM(reserved_micro_usd),0) AS cost FROM ai_generation_jobs WHERE created_at >= now()-interval '24 hours'")).rows[0].cost);
  if (reserved+cost > MATERIAL_LIMITS.dailyMicroUSD) throw new QuestionAdminError('已達最近 24 小時教材生成預留額度 USD 2，請稍後再試',429);
  const id=randomUUID(), batchId=randomUUID();
  await client.query('INSERT INTO ai_question_batches(id,request_key,request_hash,name,created_by,result) VALUES($1,$2,$3,$4,$5,$6::jsonb)',[batchId,randomUUID(),fingerprint,spec.title+'｜教材 PDF 出題',userId,JSON.stringify({generationJobId:id,excluded:[]})]);
  await client.query('INSERT INTO ai_generation_jobs(id,request_key,fingerprint,material_id,batch_id,spec,model,reserved_micro_usd,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)',[id,body.requestKey,fingerprint,spec.materialId,batchId,JSON.stringify(spec),MATERIAL_LIMITS.model,cost,userId]);
  await client.query('INSERT INTO ai_generation_items(job_id,position) SELECT $1,generate_series(1,$2::int)',[id,spec.count]);
  return {jobId:id,batchId,replayed:false};
}
export async function claimMaterialItem(client: PoolClient, id: string) {
  if (!uuid(id)) throw new QuestionAdminError('工作識別碼無效');
  await client.query('LOCK TABLE ai_generation_items IN SHARE ROW EXCLUSIVE MODE');
  const job = (await client.query('SELECT j.*,m.pages FROM ai_generation_jobs j JOIN ai_materials m ON m.id=j.material_id WHERE j.id=$1',[id])).rows[0];
  if (!job) throw new QuestionAdminError('找不到生成工作',404);
  const expired = await client.query("UPDATE ai_generation_items SET status='uncertain',error='上次呼叫結果不明，可能已計費；不會重試此題。已完成草稿保留。' WHERE job_id=$1 AND status='running' AND started_at < now()-interval '90 seconds' RETURNING position",[id]);
  if (expired.rowCount) return {stopped:true,reason:'有呼叫結果不明；確認進度後，可繼續尚未開始的題目'} as const;
  if ((await client.query("SELECT 1 FROM ai_generation_items WHERE job_id=$1 AND status='running'",[id])).rowCount) return {stopped:true,reason:'已有題目處理中，請稍後重新整理進度'} as const;
  const item = (await client.query("SELECT position FROM ai_generation_items WHERE job_id=$1 AND status='pending' ORDER BY position LIMIT 1",[id])).rows[0];
  if (!item) return {stopped:true,reason:'沒有尚未開始的題目'} as const;
  const spent = Number((await client.query("SELECT COALESCE(SUM(reserved_micro_usd),0) AS cost FROM ai_generation_items WHERE started_at >= now()-interval '24 hours'")).rows[0].cost);
  if (spent+MATERIAL_LIMITS.perQuestionMicroUSD > MATERIAL_LIMITS.dailyMicroUSD) throw new QuestionAdminError('已達最近 24 小時模型呼叫上限 USD 2',429);
  const previous = (await client.query("SELECT LEFT(q.content->>'question',160) AS question FROM ai_questions q WHERE batch_id=$1 ORDER BY position",[job.batch_id])).rows.map(r=>r.question);
  let request: ReturnType<typeof materialModelRequest>;
  try { request=materialModelRequest(job.spec,job.pages,previous,item.position); }
  catch(e) { throw new QuestionAdminError((e as Error).message); }
  const claim = randomUUID();
  await client.query("UPDATE ai_generation_items SET status='running',claim=$3,started_at=now() WHERE job_id=$1 AND position=$2",[id,item.position,claim]);
  return {stopped:false,job,position:item.position as number,claim,request} as const;
}
export async function finishMaterialItem(client: PoolClient, claim: Extract<Awaited<ReturnType<typeof claimMaterialItem>>,{stopped:false}>, output: Awaited<ReturnType<typeof callMaterialModel>> | null, failure?: string) {
  const item = (await client.query('SELECT * FROM ai_generation_items WHERE job_id=$1 AND position=$2 FOR UPDATE',[claim.job.id,claim.position])).rows[0];
  if (!item || item.claim !== claim.claim || !['running','uncertain'].includes(item.status)) return {stopped:true,reason:'這筆結果已處理'};
  let result: ReturnType<typeof generatedQuestion> | undefined;
  try { if (failure || !output) throw new Error(failure || '未取得模型結果'); result=generatedQuestion(output.value,claim.job.spec,claim.job.pages); }
  catch(e) { failure=(e as Error).message; }
  let questionId: string | null = null;
  if (result && !failure) {
    await client.query('LOCK TABLE ai_questions IN SHARE ROW EXCLUSIVE MODE');
    const fingerprint=aiFingerprint(result.question);
    if ((await client.query('SELECT id FROM ai_questions WHERE fingerprint=$1',[fingerprint])).rowCount) failure='生成內容與既有題目重複；不自動重新生成';
    else {
      questionId=randomUUID();
      await client.query('INSERT INTO ai_questions(id,batch_id,position,content,fingerprint) VALUES($1,$2,$3,$4::jsonb,$5)',[questionId,claim.job.batch_id,claim.position,JSON.stringify(result.question),fingerprint]);
      await client.query('INSERT INTO ai_question_material_sources(question_id,material_id,pdf_page,page_hash) VALUES($1,$2,$3,$4)',[questionId,claim.job.material_id,result.page,result.pageHash]);
    }
  }
  await client.query('UPDATE ai_generation_items SET status=$3,question_id=$4,error=$5,usage=$6::jsonb,actual_micro_usd=$7,finished_at=now() WHERE job_id=$1 AND position=$2',[claim.job.id,claim.position,failure?'failed':'done',questionId,failure || null,JSON.stringify(output?.usage || null),output?.actual ?? null]);
  return {stopped:!!failure,reason:failure || '已保存為草稿，尚未人工審核'};
}
export async function stepMaterialJob(id: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) throw new QuestionAdminError('尚未設定 OPENAI_API_KEY，未呼叫模型',503);
  const claim = await questionTransaction(client=>claimMaterialItem(client,id));
  if (claim.stopped) return claim;
  // Commit the claim before external I/O. Never replay a dispatched call, even after a crash.
  let output: Awaited<ReturnType<typeof callMaterialModel>> | null = null, failure: string | undefined;
  try { output=await callMaterialModel(claim.request); }
  catch(e) { failure=e instanceof Error && e.name === 'AbortError' ? '模型呼叫逾時，可能已計費；不自動重試' : e instanceof Error ? e.message : '模型呼叫失敗；不自動重試'; }
  return questionTransaction(client=>finishMaterialItem(client,claim,output,failure));
}
