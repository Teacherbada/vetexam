import 'server-only';
import { unstable_cache } from 'next/cache';
import { neon } from '@neondatabase/serverless';
import { MIN_ATTEMPTS, weeklyMostMissed, randomPublicChallenge } from './question-stats';

// Match String.trim() in usableAnswer, including Unicode whitespace.
const answerWhitespace = "\u0009\u000a\u000b\u000c\u000d \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

function database() {
  if (!process.env.DATABASE_URL) throw new Error('Missing database configuration');
  return neon(process.env.DATABASE_URL);
}

// Cache only public aggregates; never request headers, sessions or private sets.
// Keep Cache Components disabled: this is deliberately scoped to these reads.
export const readPublicAvailability = unstable_cache(async () => {
  const sql = database();
  const [availability, chapterAvailability] = await Promise.all([
    sql`SELECT q.subject, qs.exam_year AS year, COUNT(*)::int AS count
      FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
      WHERE qs.visibility='public'
        AND UPPER(BTRIM(q.answer, ${answerWhitespace})) ~ '^[A-E]$' AND
        NULLIF(BTRIM(CASE UPPER(BTRIM(q.answer, ${answerWhitespace}))
          WHEN 'A' THEN q.option_a WHEN 'B' THEN q.option_b
          WHEN 'C' THEN q.option_c WHEN 'D' THEN q.option_d
          WHEN 'E' THEN q.option_e END, ${answerWhitespace}), '') IS NOT NULL
      GROUP BY q.subject, qs.exam_year ORDER BY qs.exam_year DESC NULLS LAST`,
    sql`SELECT q.subject, qs.exam_year AS year, q.chapter, COUNT(*)::int AS count
      FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
      WHERE qs.visibility='public'
        AND UPPER(BTRIM(q.answer, ${answerWhitespace})) ~ '^[A-E]$' AND
        NULLIF(BTRIM(CASE UPPER(BTRIM(q.answer, ${answerWhitespace}))
          WHEN 'A' THEN q.option_a WHEN 'B' THEN q.option_b
          WHEN 'C' THEN q.option_c WHEN 'D' THEN q.option_d
          WHEN 'E' THEN q.option_e END, ${answerWhitespace}), '') IS NOT NULL AND q.chapter IS NOT NULL
      GROUP BY q.subject, qs.exam_year, q.chapter`,
  ]);
  return { availability, chapterAvailability };
}, ['public-home-availability-v2'], { revalidate: 120, tags: ['public-home-availability'] });

export const readWeeklyChallenge = unstable_cache(async () => {
  const sql = database();
  const query = (text: string, values: unknown[]) => sql.query(text, values);
  const weekly = await weeklyMostMissed(query);
  if (weekly[0]) return { question: weekly[0], source: 'weekly' as const, min_attempts: MIN_ATTEMPTS };
  const fallback = await randomPublicChallenge(query);
  return { question: fallback[0] ?? null, source: fallback[0] ? 'random_fallback' as const : null, min_attempts: MIN_ATTEMPTS };
}, ['public-home-weekly-v1'], { revalidate: 60, tags: ['public-home-weekly'] });
