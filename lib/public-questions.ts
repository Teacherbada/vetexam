import 'server-only';
import { cache } from 'react';
import { neon } from '@neondatabase/serverless';
import { searchQuery, SEARCH_PAGE_SIZE, type SearchFilters } from './question-search';

export type PublicQuestion = { id: number; questionSetId: number; questionNumber: number; subject: string; examYear: number | null; question: string; options: string[]; hasAnswer: boolean };
export type SearchResult = { id: number; question_number: number; subject: string; exam_year: number | null; summary: string };
function database() {
  if (!process.env.DATABASE_URL) throw new Error('Database unavailable');
  return neon(process.env.DATABASE_URL);
}
export async function searchPublicQuestions(filters: SearchFilters) {
  if (!filters.active || filters.invalid) return { rows: [] as SearchResult[], hasNext: false };
  const query = searchQuery(filters);
  const rows = await database().query(query.text, query.values) as SearchResult[];
  return { rows: rows.slice(0, SEARCH_PAGE_SIZE), hasNext: rows.length > SEARCH_PAGE_SIZE };
}
// Explicit projection: neither an answer key nor explanation reaches RSC props.
export const getPublicQuestion = cache(async (id: string): Promise<PublicQuestion | null> => {
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return null;
  const rows = await database()`SELECT q.id, q.question_set_id, q.question_number, q.subject,
    qs.exam_year, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.option_e,
    COALESCE(UPPER(BTRIM(q.answer)) ~ '^[A-E]$' AND
      NULLIF(BTRIM(CASE UPPER(BTRIM(q.answer)) WHEN 'A' THEN q.option_a WHEN 'B' THEN q.option_b
      WHEN 'C' THEN q.option_c WHEN 'D' THEN q.option_d WHEN 'E' THEN q.option_e END), '') IS NOT NULL, false) AS has_answer
    FROM questions q JOIN question_sets qs ON qs.id = q.question_set_id
    WHERE q.id = ${Number(id)} AND qs.visibility = 'public' LIMIT 1`;
  if (!rows[0]) return null;
  const row = rows[0];
  return { id: Number(row.id), questionSetId: Number(row.question_set_id), questionNumber: Number(row.question_number),
    subject: row.subject ?? '', examYear: row.exam_year == null ? null : Number(row.exam_year), question: row.question ?? '',
    options: [row.option_a ?? '', row.option_b ?? '', row.option_c ?? '', row.option_d ?? '', row.option_e ?? ''], hasAnswer: Boolean(row.has_answer) };
});
export function questionShareUrl(id: number): string | null {
  const origin = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : process.env.BETTER_AUTH_URL);
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || ['localhost', '127.0.0.1'].includes(url.hostname)) return null;
    return `${url.origin}/questions/${id}`;
  } catch { return null; }
}
