import 'server-only';
import { unstable_cache } from 'next/cache';
import { neon } from '@neondatabase/serverless';
import { MIN_ATTEMPTS, weeklyMostMissed, randomPublicChallenge } from './question-stats';

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
      GROUP BY q.subject, qs.exam_year ORDER BY qs.exam_year DESC NULLS LAST`,
    sql`SELECT q.subject, qs.exam_year AS year, q.chapter, COUNT(*)::int AS count
      FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
      WHERE qs.visibility='public' AND q.chapter IS NOT NULL
      GROUP BY q.subject, qs.exam_year, q.chapter`,
  ]);
  return { availability, chapterAvailability };
}, ['public-home-availability-v1'], { revalidate: 120, tags: ['public-home-availability'] });

export const readWeeklyChallenge = unstable_cache(async () => {
  const sql = database();
  const query = (text: string, values: unknown[]) => sql.query(text, values);
  const weekly = await weeklyMostMissed(query);
  if (weekly[0]) return { question: weekly[0], source: 'weekly' as const, min_attempts: MIN_ATTEMPTS };
  const fallback = await randomPublicChallenge(query);
  return { question: fallback[0] ?? null, source: fallback[0] ? 'random_fallback' as const : null, min_attempts: MIN_ATTEMPTS };
}, ['public-home-weekly-v1'], { revalidate: 60, tags: ['public-home-weekly'] });
