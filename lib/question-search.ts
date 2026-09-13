export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_SUBJECTS = ['獸醫病理學', '獸醫藥理學', '獸醫實驗診斷學', '獸醫普通疾病學', '獸醫傳染病學', '獸醫公共衛生學'];
export type SearchParams = Record<string, string | string[] | undefined>;
export function parseSearch(params: SearchParams) {
  const value = (key: string) => typeof params[key] === 'string' ? params[key].trim() : '';
  const integer = (key: string, max: number) => /^\d+$/.test(value(key)) && Number(value(key)) > 0 && Number(value(key)) <= max ? Number(value(key)) : null;
  const q = value('q').slice(0, 200);
  const subject = value('subject');
  const year = integer('year', 9999);
  const number = integer('number', 2147483647);
  const set = integer('set', 2147483647);
  const invalid = (subject !== '' && !SEARCH_SUBJECTS.includes(subject)) || ['year', 'number', 'set'].some(key => value(key) !== '' && !integer(key, key === 'year' ? 9999 : 2147483647));
  return { q, subject, year, number, set, page: integer('page', 10000) ?? 1, invalid, active: Boolean(q || subject || year || number || set) };
}
export type SearchFilters = ReturnType<typeof parseSearch>;
export function searchUrl(filters: SearchFilters, page = 1) {
  const params = new URLSearchParams();
  for (const key of ['q', 'subject', 'year', 'number', 'set'] as const) if (filters[key]) params.set(key, String(filters[key]));
  if (page > 1) params.set('page', String(page));
  return `/questions/search?${params}`;
}
export function searchQuery(filters: SearchFilters) {
  const keyword = filters.q ? `%${filters.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  return { text: `SELECT q.id, q.question_number, q.subject, qs.exam_year,
    LEFT(q.question, 160) AS summary
    FROM questions q JOIN question_sets qs ON qs.id = q.question_set_id
    WHERE qs.visibility = 'public'
      AND ($1::text IS NULL OR q.question ILIKE $1 OR q.option_a ILIKE $1
        OR q.option_b ILIKE $1 OR q.option_c ILIKE $1 OR q.option_d ILIKE $1)
      AND ($2::text IS NULL OR q.subject = $2)
      AND ($3::integer IS NULL OR qs.exam_year = $3 OR qs.exam_year = $4)
      AND ($5::integer IS NULL OR q.question_number = $5)
      AND ($6::integer IS NULL OR q.question_set_id = $6)
    ORDER BY qs.exam_year DESC NULLS LAST, q.question_number ASC, q.id ASC
    LIMIT $7 OFFSET $8`, values: [keyword, filters.subject || null, filters.year,
      filters.year === null ? null : filters.year >= 1912 ? filters.year - 1911 : filters.year + 1911,
      filters.number, filters.set, SEARCH_PAGE_SIZE + 1, (filters.page - 1) * SEARCH_PAGE_SIZE] };
}
