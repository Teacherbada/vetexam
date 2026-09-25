import 'server-only';
import type { PoolClient } from 'pg';
import { recordFirstAnswers } from './question-stats';
import { legacyAnsweredIds } from './question-state';
import { recordMemory } from './question-memory-service';

// All history queries are scoped before aggregation. Existing coach snapshots stay authoritative.
export const HISTORY_SQL = `
  SELECT p.question_id, q.subject, q.chapter, p.selected_answer, p.is_correct, p.answered_at, p.mode
  FROM practice_attempts p JOIN questions q ON q.id=p.question_id WHERE p.user_id=$1
  UNION ALL
  SELECT i.source_question_id, i.subject, i.chapter, i.selected_answer, i.is_correct, i.answered_at, d.kind
  FROM diagnostic_items i JOIN diagnostic_sessions d ON d.id=i.session_id
  WHERE d.user_id=$1 AND i.answered_at IS NOT NULL`;

export async function readLearning(client: PoolClient, userId: string) {
  const { rows: first } = await client.query(`SELECT s.question_id, q.subject, s.is_correct FROM question_answer_stats s
    JOIN questions q ON q.id=s.question_id WHERE s.user_id=$1`, [userId]);
  const progress: Record<string, { answered: number[]; correct: number; wrong: number }> = Object.create(null);
  for (const row of first) {
    const group = progress[row.subject] ??= { answered: [], correct: 0, wrong: 0 };
    group.answered.push(row.question_id); group[row.is_correct ? 'correct' : 'wrong']++;
  }
  const { rows: history } = await client.query(`SELECT * FROM (${HISTORY_SQL}) h ORDER BY answered_at, question_id`, [userId]);
  const { rows: review } = await client.query(`WITH wrong AS (
    SELECT question_id,MAX(answered_at) AS last_wrong,(ARRAY_AGG(selected_answer ORDER BY answered_at DESC))[1] AS user_answer FROM (
      SELECT question_id,created_at AS answered_at,selected_answer FROM question_answer_stats WHERE user_id=$1 AND NOT is_correct
      UNION ALL SELECT question_id,answered_at,selected_answer FROM (${HISTORY_SQL}) h WHERE NOT is_correct
    ) answers GROUP BY question_id
  ) SELECT q.id, q.subject, q.question, q.answer, q.explanation,
    jsonb_build_array(q.option_a,q.option_b,q.option_c,q.option_d) AS options,
    COALESCE(r.favorite,FALSE) AS favorite,
    (r.wrong IS TRUE OR w.question_id IS NOT NULL AND (r.wrong IS DISTINCT FROM FALSE OR w.last_wrong > r.wrong_updated_at)) AS wrong,
    w.user_answer AS "userAnswer",
    COALESCE(r.note,'') AS note
    FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
    LEFT JOIN question_review_state r ON r.question_id=q.id AND r.user_id=$1
    LEFT JOIN wrong w ON w.question_id=q.id
    WHERE qs.visibility='public' AND (r.favorite OR r.wrong IS TRUE OR w.question_id IS NOT NULL AND (r.wrong IS DISTINCT FROM FALSE OR w.last_wrong > r.wrong_updated_at))`, [userId]);
  const { rows: imports } = await client.query('SELECT payload FROM learning_imports WHERE user_id=$1', [userId]);
  return { owner: userId, progress, history, favorites: review.filter(r => r.favorite), wrongQuestions: review.filter(r => r.wrong), legacy: imports.map(r => r.payload) };
}

export async function recordPractice(client: PoolClient, userId: string, answers: { question_id: number; selected_answer: string; event_id: string; answered_at?: string }[], mode: 'practice' | 'exam') {
  // Includes first-ever cards: a row lock alone cannot lock a missing memory row.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('practice-memory:' || $1,0))", [userId]);
  await client.query('LOCK TABLE question_answer_stats IN ROW EXCLUSIVE MODE');
  // Use the existing validator/writer, including visibility and available-option checks.
  await recordFirstAnswers(async (text, values) => (await client.query(text, values)).rows, userId, answers);
  const inserted = await client.query(`INSERT INTO practice_attempts(user_id,event_id,question_id,selected_answer,is_correct,mode,answered_at)
    SELECT $1,a.event_id,q.id,a.selected_answer,UPPER(BTRIM(q.answer))=a.selected_answer,$3,COALESCE(a.answered_at,CURRENT_TIMESTAMP)
    FROM jsonb_to_recordset($2::jsonb) a(event_id uuid,question_id integer,selected_answer text,answered_at timestamptz)
    JOIN questions q ON q.id=a.question_id JOIN question_sets qs ON qs.id=q.question_set_id
    WHERE qs.visibility='public' AND UPPER(BTRIM(q.answer)) ~ '^[A-E]$'
    AND NULLIF(BTRIM(CASE UPPER(BTRIM(q.answer)) WHEN 'A' THEN q.option_a WHEN 'B' THEN q.option_b WHEN 'C' THEN q.option_c WHEN 'D' THEN q.option_d WHEN 'E' THEN q.option_e END),'') IS NOT NULL
    AND NULLIF(BTRIM(CASE a.selected_answer WHEN 'A' THEN q.option_a WHEN 'B' THEN q.option_b WHEN 'C' THEN q.option_c WHEN 'D' THEN q.option_d WHEN 'E' THEN q.option_e END),'') IS NOT NULL
    ON CONFLICT(user_id,event_id) DO NOTHING RETURNING question_id,is_correct,answered_at,event_id`, [userId, JSON.stringify(answers), mode]);
  await recordMemory(client,userId,inserted.rows);
}

export async function readQuestionState(client: PoolClient, userId: string) {
  const { rows } = await client.query(`SELECT question_id,BOOL_OR(NOT is_correct) AS wrong FROM (
    SELECT question_id,is_correct FROM question_answer_stats WHERE user_id=$1
    UNION ALL SELECT question_id,is_correct FROM (${HISTORY_SQL}) h
  ) answers GROUP BY question_id`, [userId]);
  const { rows: favorites } = await client.query('SELECT question_id FROM question_review_state WHERE user_id=$1 AND favorite', [userId]);
  const { rows: archives } = await client.query('SELECT payload FROM learning_imports WHERE user_id=$1', [userId]);
  const oldWrong = archives.flatMap(row => Array.isArray(row.payload.wrongQuestions) ? row.payload.wrongQuestions.filter((q: { id: number }) => q && Number.isInteger(q.id) && q.id > 0 && q.id <= 2147483647).map((q: { id: number }) => q.id) : []);
  return { answered: [...new Set([...rows.map(row => row.question_id), ...legacyAnsweredIds(archives.map(row => row.payload)), ...oldWrong])],
    wrong: [...new Set([...rows.filter(row => row.wrong).map(row => row.question_id), ...oldWrong])], favorites: favorites.map(row => row.question_id) };
}
