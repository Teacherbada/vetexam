import 'server-only';
import type { PoolClient } from 'pg';
import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs';

// Scheduler only: fixed library defaults, no optimizer, network calls or fuzz.
const scheduler = fsrs({ enable_fuzz: false });
export type MemoryRow = Card & { question_id: number; updated_at: Date };
export type MemorySignal = { due: string; last_review: string | null };
type Attempt = { question_id: number; is_correct: boolean; answered_at: Date; event_id: string };

export function reviewMemory(previous: Card | undefined, correct: boolean, answeredAt: Date): Card {
  // Offline queues can arrive out of order. Never move the card clock backwards
  // or replay history; still count each newly accepted event exactly once.
  const at = new Date(Math.max(answeredAt.getTime(), previous?.last_review?.getTime() ?? 0));
  return scheduler.next(previous ?? createEmptyCard(at), at, correct ? Rating.Good : Rating.Again).card;
}

// Caller holds the account transaction lock and supplies INSERT RETURNING rows only.
export async function recordMemory(client: PoolClient, userId: string, attempts: Attempt[]) {
  if (!attempts.length) return;
  const { rows } = await client.query<MemoryRow>('SELECT * FROM question_memory_state WHERE user_id=$1 AND question_id=ANY($2::integer[]) ORDER BY question_id FOR UPDATE', [userId,[...new Set(attempts.map(row=>row.question_id))]]);
  const cards = new Map<number, Card>(rows.map(row=>[row.question_id,row]));
  for (const attempt of [...attempts].sort((a,b) => a.answered_at.getTime()-b.answered_at.getTime() || a.event_id.localeCompare(b.event_id))) {
    cards.set(attempt.question_id,reviewMemory(cards.get(attempt.question_id), attempt.is_correct, attempt.answered_at));
  }
  await client.query(`INSERT INTO question_memory_state
      (user_id,question_id,due,stability,difficulty,elapsed_days,scheduled_days,learning_steps,reps,lapses,state,last_review)
      SELECT $1,question_id,due,stability,difficulty,elapsed_days,scheduled_days,learning_steps,reps,lapses,state,last_review
      FROM jsonb_to_recordset($2::jsonb) AS c(question_id integer,due timestamptz,stability float8,difficulty float8,
        elapsed_days integer,scheduled_days integer,learning_steps integer,reps integer,lapses integer,state smallint,last_review timestamptz)
      ON CONFLICT(user_id,question_id) DO UPDATE SET due=EXCLUDED.due,stability=EXCLUDED.stability,
      difficulty=EXCLUDED.difficulty,elapsed_days=EXCLUDED.elapsed_days,scheduled_days=EXCLUDED.scheduled_days,
      learning_steps=EXCLUDED.learning_steps,reps=EXCLUDED.reps,lapses=EXCLUDED.lapses,state=EXCLUDED.state,
      last_review=EXCLUDED.last_review,updated_at=clock_timestamp()`,
    [userId,JSON.stringify([...cards].map(([question_id,card])=>({...card,question_id})))]);
}

export async function readMemory(client: PoolClient, userId: string, questionIds: number[], now = new Date()) {
  if (!questionIds.length) return [];
  const { rows } = await client.query<MemoryRow>(`SELECT m.* FROM question_memory_state m
    JOIN questions q ON q.id=m.question_id JOIN question_sets qs ON qs.id=q.question_set_id
    WHERE m.user_id=$1 AND m.question_id=ANY($2::integer[]) AND qs.visibility='public'`, [userId,questionIds]);
  return rows.map(card => ({ question_id:card.question_id, due:card.due.toISOString(),
    last_review:card.last_review?.toISOString() ?? null, stability:card.stability, difficulty:card.difficulty,
    retrievability:scheduler.get_retrievability(card, new Date(Math.max(now.getTime(),card.last_review?.getTime() ?? 0)), false) }));
}

// A failed SQL statement aborts PostgreSQL transactions unless rolled back to a savepoint.
export async function dailyMemorySignals(client: PoolClient, userId: string, questionIds: number[]): Promise<Map<number, MemorySignal>> {
  await client.query('SAVEPOINT daily_memory');
  try {
    return new Map((await readMemory(client,userId,questionIds)).map(row => [row.question_id,row]));
  } catch {
    await client.query('ROLLBACK TO SAVEPOINT daily_memory');
    return new Map();
  } finally {
    await client.query('RELEASE SAVEPOINT daily_memory');
  }
}
