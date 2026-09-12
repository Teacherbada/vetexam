import "server-only";

export const MIN_ATTEMPTS = 10;
export const MAX_STATS_BATCH = 100;
export const MAX_RANKED_QUESTIONS = 20;
export type AnswerSubmission = { question_id: number; selected_answer: string };
type Query = (text: string, values: unknown[]) => Promise<Record<string, unknown>[]>;

export function parseAnswerSubmissions(body: unknown): AnswerSubmission[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "answers") || !Array.isArray(input.answers) || !input.answers.length || input.answers.length > MAX_STATS_BATCH) return null;
  const result: AnswerSubmission[] = [];
  const seen = new Set<number>();
  for (const value of input.answers) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["question_id", "selected_answer"].includes(key)) ||
      typeof row.question_id !== "number" || !Number.isInteger(row.question_id) || row.question_id < 1 || row.question_id > 2147483647 ||
      typeof row.selected_answer !== "string" || !/^[A-E]$/.test(row.selected_answer)) return null;
    // A single payload may not replace its first answer with a later one.
    if (!seen.has(row.question_id)) result.push({ question_id: row.question_id, selected_answer: row.selected_answer });
    seen.add(row.question_id);
  }
  return result;
}

export const INSERT_FIRST_ANSWERS_SQL = `
  INSERT INTO question_answer_stats (user_id, question_id, is_correct)
  SELECT $1, q.id, UPPER(BTRIM(q.answer)) = submitted.selected_answer
  FROM jsonb_to_recordset($2::jsonb) AS submitted(question_id integer, selected_answer text)
  JOIN questions q ON q.id = submitted.question_id
  JOIN question_sets qs ON qs.id = q.question_set_id
  WHERE qs.visibility = 'public' AND UPPER(BTRIM(q.answer)) ~ '^[A-E]$'
    AND NULLIF(BTRIM(CASE submitted.selected_answer
      WHEN 'A' THEN q.option_a WHEN 'B' THEN q.option_b WHEN 'C' THEN q.option_c
      WHEN 'D' THEN q.option_d WHEN 'E' THEN q.option_e END), '') IS NOT NULL
  ORDER BY q.id
  ON CONFLICT (user_id, question_id) DO NOTHING
  RETURNING id
`;

export async function recordFirstAnswers(query: Query, userId: string, answers: AnswerSubmission[]) {
  await query(INSERT_FIRST_ANSWERS_SQL, [userId, JSON.stringify(answers)]);
}

export const MOST_MISSED_SQL = `
  WITH totals AS (
    SELECT s.question_id, COUNT(*)::int AS total_attempts,
      COUNT(*) FILTER (WHERE NOT s.is_correct)::int AS wrong_attempts,
      COUNT(*) FILTER (WHERE s.is_correct)::int AS correct_attempts,
      COUNT(*) FILTER (WHERE NOT s.is_correct)::numeric / COUNT(*) AS wrong_fraction
    FROM question_answer_stats s
    JOIN questions q ON q.id = s.question_id
    JOIN question_sets qs ON qs.id = q.question_set_id
    WHERE qs.visibility = 'public'
      AND ($1::text = 'all' OR s.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days')
      AND ($2::text IS NULL OR q.subject = $2)
      AND ($3::integer IS NULL OR qs.exam_year = $3)
    GROUP BY s.question_id HAVING COUNT(*) >= $4
  )
  SELECT q.id AS question_id, q.question_number, qs.exam_year, q.subject AS exam_subject,
    q.question, q.option_a, q.option_b, q.option_c, q.option_d,
    t.total_attempts, t.wrong_attempts, t.correct_attempts,
    ROUND(t.wrong_fraction * 100, 1)::float8 AS wrong_rate
  FROM totals t JOIN questions q ON q.id = t.question_id
  JOIN question_sets qs ON qs.id = q.question_set_id
  ORDER BY t.wrong_fraction DESC, t.total_attempts DESC, q.id ASC LIMIT $5
`;

export async function mostMissed(query: Query, range: "all" | "7d", subject: string | null, year: number | null) {
  return query(MOST_MISSED_SQL, [range, subject, year, MIN_ATTEMPTS, MAX_RANKED_QUESTIONS]);
}
