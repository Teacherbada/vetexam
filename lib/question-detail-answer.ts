import 'server-only';
import type { PoolClient } from 'pg';
import { usableAnswer } from './question-answer';
import { recordFirstAnswers, type AnswerSubmission } from './question-stats';

// Uses the same validity rules and first-answer writer as the existing quiz.
// The caller owns the transaction, including the admin correction lock.
export async function answerPublicQuestion(client: PoolClient, userId: string | null, submission: AnswerSubmission) {
  await client.query('LOCK TABLE question_answer_stats IN ROW EXCLUSIVE MODE');
  const { rows } = await client.query(`SELECT q.answer, q.explanation,
    q.option_a, q.option_b, q.option_c, q.option_d, q.option_e
    FROM questions q JOIN question_sets qs ON qs.id = q.question_set_id
    WHERE q.id = $1 AND qs.visibility = 'public'`, [submission.question_id]);
  if (!rows[0]) return { status: 404, body: { error: '找不到題目' } };
  const row = rows[0];
  const options = [row.option_a ?? '', row.option_b ?? '', row.option_c ?? '', row.option_d ?? '', row.option_e ?? ''];
  const answer = usableAnswer({ answer: row.answer, options });
  if (!answer) return { status: 200, body: { available: false, message: '本題正確答案目前正在整理中。' } };
  if (!options[submission.selected_answer.charCodeAt(0) - 65]?.trim()) return { status: 400, body: { error: '請選擇有效選項' } };
  if (userId) await recordFirstAnswers(async (text, values) => (await client.query(text, values)).rows, userId, [submission]);
  return { status: 200, body: { available: true, selected_answer: submission.selected_answer,
    answer, correct: submission.selected_answer === answer, explanation: row.explanation ?? '' } };
}
