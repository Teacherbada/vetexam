import 'server-only';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { validId } from './admin-question-input';
import { QuestionAdminError } from './admin-questions';

type Query = (text: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
const selection = `SELECT q.id,q.explanation FROM questions q
  JOIN question_sets qs ON qs.id=q.question_set_id
  WHERE q.id=$1 AND q.kind='exam' AND qs.visibility='public'`;
const snapshot = (row: Record<string, unknown>) => ({
  id: Number(row.id), explanation: (row.explanation ?? '') as string,
  revision: createHash('sha256').update(JSON.stringify([row.id, row.explanation])).digest('hex'),
});

export function explanationId(value: unknown): number {
  if (!validId(value)) throw new QuestionAdminError('題目 ID 無效');
  return value;
}

export function parseExplanation(input: Record<string, unknown>) {
  if (Object.keys(input).some(key => !['id', 'explanation', 'revision'].includes(key))) {
    throw new QuestionAdminError('只允許更新官方解析');
  }
  const id = explanationId(input.id);
  if (typeof input.explanation !== 'string' || !input.explanation.trim()) {
    throw new QuestionAdminError('請填寫官方解析；本功能不提供清空既有解析');
  }
  if (input.explanation.length > 20000 || input.explanation.includes('\0')) {
    throw new QuestionAdminError('官方解析最多 20,000 字元，且不能包含空字元');
  }
  if (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/.test(input.revision)) {
    throw new QuestionAdminError('請先載入官方解析後再儲存');
  }
  return { id, explanation: input.explanation, revision: input.revision };
}

export async function readExplanation(query: Query, id: number) {
  const rows = await query(selection, [id]);
  if (!rows.length) throw new QuestionAdminError('找不到可編輯的公開國考題目', 404);
  return snapshot(rows[0]);
}

// Called inside questionTransaction. Lock the question and its bank so visibility
// cannot change between authorization of the resource and the single-column write.
export async function saveExplanation(client: Pick<PoolClient, 'query'>, input: ReturnType<typeof parseExplanation>) {
  const { rows } = await client.query(selection + ' FOR UPDATE OF q,qs', [input.id]);
  if (!rows.length) throw new QuestionAdminError('找不到可編輯的公開國考題目', 404);
  const current = snapshot(rows[0]);
  if (current.revision !== input.revision) {
    // A successful request may be retried after its response was lost.
    if (current.explanation === input.explanation) return current;
    throw new QuestionAdminError('解析已由其他操作更新。請保留你的草稿，重新載入最新解析後再核對修改。', 409);
  }
  const result = await client.query('UPDATE questions SET explanation=$2 WHERE id=$1 RETURNING id,explanation', [input.id, input.explanation]);
  return snapshot(result.rows[0]);
}
