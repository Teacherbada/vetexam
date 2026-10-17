import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { validId } from './admin-question-input';
import { QuestionAdminError } from './admin-questions';

type Query = (text: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
const selection = `SELECT q.id,q.explanation,q.explanation_binding,vetexam_explanation_source(q.id) AS source_signature,
  COALESCE(to_jsonb(q)->>'explanation_status','draft') AS explanation_status,
  COALESCE(to_jsonb(q)->>'explanation_version','0') AS explanation_version FROM questions q
  JOIN question_sets qs ON qs.id=q.question_set_id
  WHERE q.id=$1 AND q.kind='exam' AND qs.visibility='public'`;
const snapshot = (row: Record<string, unknown>) => ({
  id: Number(row.id), explanation: (row.explanation ?? '') as string,
  status: !(row.explanation as string | null)?.trim() ? 'unwritten' : row.explanation_status === 'published' ? 'published' : 'draft',
  sourceChanged: !!row.explanation_binding && (row.explanation_binding as Record<string,unknown>).sourceSignature!==row.source_signature,
  revision: createHash('sha256').update(JSON.stringify([row.id, row.explanation, row.explanation_status, row.explanation_version,row.source_signature,row.explanation_binding])).digest('hex'),
});

export function explanationId(value: unknown): number {
  if (!validId(value)) throw new QuestionAdminError('題目 ID 無效');
  return value;
}

export function parseExplanation(input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !['id', 'explanation', 'revision', 'action', 'confirmReview','confirmSourceReview'].includes(key))) {
    throw new QuestionAdminError('只允許更新精選解析');
  }
  const id = explanationId(input.id);
  const action = input.action ?? 'draft'; // Older clients can only save a draft.
  if (typeof action !== 'string' || !['draft', 'publish', 'unpublish'].includes(action)) throw new QuestionAdminError('解析操作無效');
  if (action === 'publish' && input.confirmReview !== true) throw new QuestionAdminError('請先確認已人工核對解析');
  if (action !== 'unpublish' && (typeof input.explanation !== 'string' || !input.explanation.trim())) {
    throw new QuestionAdminError('請填寫精選解析；本功能不提供清空既有解析');
  }
  if (action !== 'unpublish' && ((input.explanation as string).length > 20000 || (input.explanation as string).includes('\0'))) {
    throw new QuestionAdminError('精選解析最多 20,000 字元，且不能包含空字元');
  }
  if (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) {
    throw new QuestionAdminError('請先載入精選解析後再儲存');
  }
  return { id, explanation: action === 'unpublish' ? undefined : input.explanation as string, revision: input.revision, action,confirmSourceReview:input.confirmSourceReview===true };
}

export async function readExplanation(query: Query, id: number) {
  const rows = await query(selection, [id]);
  if (!rows.length) throw new QuestionAdminError('找不到可編輯的公開國考題目', 404);
  return snapshot(rows[0]);
}

// Called inside questionTransaction. Lock the question and its bank so visibility
// cannot change between authorization of the resource and the single-column write.
export async function saveExplanation(client: Pick<PoolClient, 'query'>, input: ReturnType<typeof parseExplanation>,actor='unknown') {
  const { rows } = await client.query(selection + ' FOR UPDATE OF q,qs', [input.id]);
  if (!rows.length) throw new QuestionAdminError('找不到可編輯的公開國考題目', 404);
  const current = snapshot(rows[0]);
  const status = input.action === 'publish' ? 'published' : 'draft';
  const explanation = input.action === 'unpublish' ? current.explanation : input.explanation!;
  const binding=rows[0].explanation_binding as Record<string,unknown>|null;
  if (current.revision !== input.revision) {
    // Replay only the immediately preceding operation, bound to its source version.
    if(!current.sourceChanged&&binding?.previousRevision===input.revision&&binding?.lastAction===input.action&&current.explanation===explanation&&current.status===status)return current;
    throw new QuestionAdminError('解析已由其他操作更新。請保留你的草稿，重新載入最新解析後再核對修改。', 409);
  }
  if(input.action==='publish'&&current.sourceChanged)throw new QuestionAdminError('題目或來源版本已變更。請核對最新題目、原圖、官方答案與來源，確認後先重新儲存草稿，再次審核發布。',409);
  await client.query('SELECT question_id FROM question_proofreading WHERE question_id=$1 FOR UPDATE',[input.id]);
  const nextBinding=input.action==='unpublish'?(binding?{...binding,reviewStatus:'pending_review',reviewedBy:null,reviewedAt:null,previousRevision:input.revision,lastAction:input.action}:null):current.sourceChanged&&!input.confirmSourceReview?binding:{
    ...binding,sourceSignature:rows[0].source_signature,reviewStatus:input.action==='publish'?'human_reviewed':'pending_review',
    previousRevision:input.revision,lastAction:input.action,
    reviewedBy:input.action==='publish'?actor:null,reviewedAt:input.action==='publish'?new Date().toISOString():null,
  };
  // Unpublish preserves the saved body, even if a caller submits a different text.
  await client.query(`UPDATE questions SET explanation=$2,explanation_status=$3,
    explanation_version=explanation_version+1,explanation_binding=$4::jsonb WHERE id=$1
    RETURNING id`, [input.id, explanation, status,JSON.stringify(nextBinding)]);
  const after=await readExplanation(async(text,values)=>(await client.query(text,values)).rows,input.id);
  await client.query(`INSERT INTO explanation_review_events(question_id,actor_id,action,before_data,after_data)
    VALUES($1,$2,$3,$4::jsonb,$5::jsonb)`,[input.id,actor,input.action,JSON.stringify(current),JSON.stringify(after)]);
  return after;
}
