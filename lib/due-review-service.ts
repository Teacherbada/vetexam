import 'server-only';
import type { PoolClient } from 'pg';
import { memoryRetrievability, type MemoryRow } from './question-memory-service';
import { reviewBoundaries, reviewLimit, type DueReview } from './due-review';

const eligible = `FROM question_memory_state m
  JOIN questions q ON q.id=m.question_id
  JOIN question_sets qs ON qs.id=q.question_set_id
  WHERE m.user_id=$1 AND qs.visibility='public'
  AND UPPER(BTRIM(q.answer)) ~ '^[A-E]$'
  AND NULLIF(BTRIM(CASE UPPER(BTRIM(q.answer)) WHEN 'A' THEN q.option_a WHEN 'B' THEN q.option_b
    WHEN 'C' THEN q.option_c WHEN 'D' THEN q.option_d WHEN 'E' THEN q.option_e END),'') IS NOT NULL`;

export async function readDueReview(client: PoolClient, userId: string, limit = 20, now = new Date()): Promise<DueReview> {
  if (reviewLimit(String(limit)) === null) throw new Error('Invalid review limit');
  const { todayEnd, upcomingEnd } = reviewBoundaries(now);
  const { rows: counts } = await client.query(`SELECT
    COUNT(*) FILTER (WHERE m.due <= $2)::int AS "dueNow",
    COUNT(*) FILTER (WHERE m.due < $3)::int AS "dueToday",
    COUNT(*) FILTER (WHERE m.due > $2 AND m.due <= $4)::int AS "upcoming7Days"
    ${eligible} AND m.due <= $4`, [userId, now, todayEnd, upcomingEnd]);
  // The primary key in the requested ordering is due. Keep all cutoff ties so
  // the official scheduler, not a second SQL implementation, breaks those ties.
  // Only card metadata crosses this boundary; question/image bodies are bounded.
  const { rows: cards } = await client.query<MemoryRow>(`SELECT m.* ${eligible}
    AND m.due <= $2 ORDER BY m.due FETCH FIRST $3 ROWS WITH TIES`, [userId, now, limit]);
  const ranked = cards.map(card => ({ card, retrievability: memoryRetrievability(card, now) }));
  ranked.sort((a, b) => +a.card.due - +b.card.due || a.retrievability - b.retrievability ||
    (a.card.last_review?.getTime() ?? 0) - (b.card.last_review?.getTime() ?? 0) || a.card.question_id - b.card.question_id);
  const ids = ranked.slice(0, limit).map(({ card }) => card.question_id);
  const { rows } = ids.length ? await client.query(`SELECT q.id,q.question_set_id,q.question_number,q.subject,q.question,
    q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,UPPER(BTRIM(q.answer)) AS answer,q.explanation,q.image_data_url,
    qs.exam_year,qs.name AS question_set_name ${eligible} AND m.due <= $2 AND q.id=ANY($3::integer[])`, [userId, now, ids]) : { rows: [] };
  const questions = new Map(rows.map(q => [q.id, {
    id: q.id, questionSetId: q.question_set_id, questionNumber: q.question_number,
    subject: q.subject ?? '', question: q.question ?? '',
    options: [q.option_a ?? '', q.option_b ?? '', q.option_c ?? '', q.option_d ?? '', q.option_e ?? ''],
    answer: q.answer, explanation: q.explanation ?? '', imageDataUrl: q.image_data_url,
    examYear: q.exam_year, questionSetName: q.question_set_name ?? '',
  }]));
  return { owner: userId, asOf: now.toISOString(), ...counts[0], queue: ids.flatMap(id => questions.has(id) ? [questions.get(id)!] : []) };
}
