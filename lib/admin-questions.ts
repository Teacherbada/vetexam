import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { needsManualReview, normalizeAnswer, parseEntries, type AdminQuestion, type AnswerInput } from './admin-question-input';

export class QuestionAdminError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Query = (text: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
export type PreviewRow = {
  question_id: number | null; question_number: number; old_answer: string | null; new_answer: string;
  status: 'added' | 'same' | 'changed' | 'skipped' | 'unmatched'; reason?: string;
  recalculate: number; remove: number;
};
export type AnswerPreview = {
  rows: PreviewRow[]; errors: string[]; expected: number; parsed: number;
  summary: { added: number; same: number; changed: number; skipped: number; unmatched: number; recalculate: number; remove: number };
  can_apply: boolean; fingerprint: string;
};

export async function buildPreview(query: Query, input: AnswerInput): Promise<AnswerPreview> {
  const sets = await query('SELECT id FROM question_sets WHERE id=$1', [input.question_set_id]);
  if (!sets.length) throw new QuestionAdminError('找不到題庫', 404);
  const questions = await query('SELECT id,question_set_id,question_number,subject,question,option_a,option_b,option_c,option_d,option_e,answer,explanation FROM questions WHERE question_set_id=$1 ORDER BY question_number,id', [input.question_set_id]) as AdminQuestion[];
  const { entries, errors } = parseEntries(input, questions);
  const statistics = await query(`SELECT s.question_id,
    COUNT(*) FILTER (WHERE s.selected_answer ~ '^[A-D]$')::int AS recalculate,
    COUNT(*) FILTER (WHERE s.selected_answer IS NULL OR s.selected_answer !~ '^[A-D]$')::int AS remove
    FROM question_answer_stats s JOIN questions q ON q.id=s.question_id
    WHERE q.question_set_id=$1 GROUP BY s.question_id`, [input.question_set_id]);
  const rows: PreviewRow[] = entries.map(entry => {
    const matches = questions.filter(q => input.mode === 'single' ? q.id === input.question_id : q.question_number === entry.question_number);
    const q = matches.length === 1 ? matches[0] : null;
    const base = { question_number: entry.question_number, question_id: q?.id ?? null, old_answer: q?.answer ?? null, new_answer: entry.answer, recalculate: 0, remove: 0 };
    if (!q) return { ...base, status: 'unmatched', reason: matches.length ? '題號重複，請使用單題 ID 編輯' : '找不到題號' };
    if (needsManualReview(q)) return { ...base, status: 'skipped', reason: '此題答案格式需要人工確認（特殊答案、第五選項或選項不完整）' };
    const old = normalizeAnswer(q.answer);
    if (old === entry.answer) return { ...base, status: 'same' };
    const stats = statistics.find(s => Number(s.question_id) === q.id);
    return { ...base, status: old ? 'changed' : 'added', recalculate: Number(stats?.recalculate ?? 0), remove: Number(stats?.remove ?? 0) };
  });
  const summary = { added: 0, same: 0, changed: 0, skipped: 0, unmatched: 0, recalculate: 0, remove: 0 };
  for (const row of rows) { summary[row.status]++; summary.recalculate += row.recalculate; summary.remove += row.remove; }
  const fingerprint = createHash('sha256').update(JSON.stringify({ input, questions, rows, errors })).digest('hex');
  return { rows, errors, expected: questions.length, parsed: entries.length, summary,
    can_apply: !errors.length && !summary.unmatched && summary.added + summary.changed > 0, fingerprint };
}

function sign(payload: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('Preview signing unavailable');
  return createHmac('sha256', secret).update('admin-question-preview-v1:' + payload).digest('base64url');
}
export function issuePreviewToken(fingerprint: string, userId: string) {
  const payload = Buffer.from(JSON.stringify({ fingerprint, userId, expires: Date.now() + 15 * 60 * 1000 })).toString('base64url');
  return payload + '.' + sign(payload);
}
export function checkPreviewToken(token: unknown, fingerprint: string, userId: string) {
  if (typeof token !== 'string' || token.length > 2048) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.fingerprint === fingerprint && data.userId === userId && data.expires > Date.now();
  } catch { return false; }
}

// Caller owns the transaction. Both locks precede snapshot reads. The stats writer
// takes ROW EXCLUSIVE in a separate statement before reading the answer key.
export async function applyAnswers(client: PoolClient, input: AnswerInput, token: unknown, userId: string, confirmStats: boolean, confirmRemoval: boolean) {
  await client.query('LOCK TABLE question_answer_stats IN SHARE ROW EXCLUSIVE MODE');
  // V1 maintenance writes are rare; this also prevents inserted duplicate numbers
  // or an import/delete from changing a set between validation and UPDATE.
  await client.query('LOCK TABLE questions IN SHARE ROW EXCLUSIVE MODE');
  await client.query('SELECT id FROM question_sets WHERE id=$1 FOR SHARE', [input.question_set_id]);
  const preview = await buildPreview(async (text, values) => (await client.query(text, values)).rows, input);
  if (!preview.can_apply) throw new QuestionAdminError('預覽有錯誤或沒有可套用的答案');
  if (!checkPreviewToken(token, preview.fingerprint, userId)) throw new QuestionAdminError('題目或統計已變更，或預覽已過期，請重新解析預覽', 409);
  if ((preview.summary.recalculate || preview.summary.remove) && !confirmStats) throw new QuestionAdminError('請明確確認統計重算');
  if (preview.summary.remove && !confirmRemoval) throw new QuestionAdminError('請明確確認清除無法重算的舊統計');
  const changes = preview.rows.filter(row => row.status === 'added' || row.status === 'changed');
  const payload = JSON.stringify(changes.map(row => ({ id: row.question_id, answer: row.new_answer })));
  await client.query(`UPDATE questions q SET answer=v.answer
    FROM jsonb_to_recordset($1::jsonb) AS v(id integer,answer text)
    WHERE q.id=v.id AND q.question_set_id=$2`, [payload, input.question_set_id]);
  await client.query(`UPDATE question_answer_stats s SET is_correct=(s.selected_answer=v.answer),updated_at=CURRENT_TIMESTAMP
    FROM jsonb_to_recordset($1::jsonb) AS v(id integer,answer text)
    WHERE s.question_id=v.id AND s.selected_answer ~ '^[A-D]$'`, [payload]);
  await client.query(`DELETE FROM question_answer_stats s USING jsonb_to_recordset($1::jsonb) AS v(id integer,answer text)
    WHERE s.question_id=v.id AND (s.selected_answer IS NULL OR s.selected_answer !~ '^[A-D]$')`, [payload]);
  return preview.summary;
}
