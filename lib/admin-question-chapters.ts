import 'server-only';
import type { PoolClient } from 'pg';
import { EXAM_SUBJECTS, validChapter } from '../data/exam-chapters';
import { QuestionAdminError } from './admin-questions';

type Query = (text: string, values: unknown[]) => Promise<Record<string, unknown>[]>;
export type ChapterQuestion = {
  id: number; question_set_id: number; question_number: number; subject: string;
  question: string; option_a: string; option_b: string; option_c: string; option_d: string;
  option_e: string | null; answer: string; explanation: string; chapter: string | null;
  exam_year: number | null; question_set_name: string; visibility: string;
};
export type ChapterQueue = {
  progress: { total: number; classified: number; unclassified: number };
  matching: number; question: ChapterQuestion | null;
};

export async function readChapterQueue(query: Query, params: URLSearchParams): Promise<ChapterQueue> {
  const subject = params.get('subject') ?? '';
  const status = params.get('status') ?? 'unclassified';
  if (!EXAM_SUBJECTS.includes(subject) || !['all', 'unclassified', 'classified'].includes(status)) throw new QuestionAdminError('請確認科目與分類狀態');
  const integer = (key: string, fallback: number | null) => {
    const value = params.get(key);
    if (!value) return fallback;
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) throw new QuestionAdminError('題庫或題目 ID 無效');
    return Number(value);
  };
  const setId = integer('question_set_id', null), after = integer('after', 0);
  const scope = 'q.subject=$1 AND ($2::int IS NULL OR q.question_set_id=$2)';
  const filter = "($3::text='all' OR ($3='unclassified' AND q.chapter IS NULL) OR ($3='classified' AND q.chapter IS NOT NULL))";
  const counts = await query(`SELECT COUNT(*)::int AS total, COUNT(q.chapter)::int AS classified,
    COUNT(*) FILTER (WHERE q.chapter IS NULL)::int AS unclassified,
    COUNT(*) FILTER (WHERE ${filter})::int AS matching
    FROM questions q WHERE ${scope}`, [subject, setId, status]);
  const questions = await query(`SELECT q.id,q.question_set_id,q.question_number,q.subject,q.question,
    q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,q.answer,q.explanation,q.chapter,
    qs.exam_year,qs.name AS question_set_name,qs.visibility
    FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
    WHERE ${scope} AND ${filter} AND q.id>$4 ORDER BY q.id LIMIT 1`, [subject, setId, status, after]);
  const count = counts[0];
  return { progress: { total: Number(count.total), classified: Number(count.classified), unclassified: Number(count.unclassified) },
    matching: Number(count.matching), question: (questions[0] as ChapterQuestion | undefined) ?? null };
}

// The caller owns the transaction. Read the subject from the locked DB row, never from the client.
export async function updateQuestionChapter(client: Pick<PoolClient, 'query'>, body: Record<string, unknown>) {
  if (Object.keys(body).some(key => !['questionId', 'chapter', 'previousChapter'].includes(key)) ||
    !Number.isInteger(body.questionId) || Number(body.questionId) < 1 || Number(body.questionId) > 2147483647 ||
    typeof body.chapter !== 'string' || !body.chapter || body.chapter.length > 100 ||
    !(body.previousChapter === null || (typeof body.previousChapter === 'string' && body.previousChapter.length <= 100))) {
    throw new QuestionAdminError('請選擇題目與既有章節');
  }
  const result = await client.query('SELECT subject,chapter FROM questions WHERE id=$1 FOR UPDATE', [body.questionId]);
  const question = result.rows[0];
  if (!question) throw new QuestionAdminError('找不到題目', 404);
  if (!validChapter(question.subject, body.chapter)) throw new QuestionAdminError('此章節不屬於題目的科目');
  if (question.chapter !== body.previousChapter) throw new QuestionAdminError('此題章節已變更，請重新讀取後再儲存', 409);
  await client.query('UPDATE questions SET chapter=$1 WHERE id=$2', [body.chapter, body.questionId]);
  return { questionId: body.questionId, chapter: body.chapter };
}
