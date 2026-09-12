import "server-only";

export const MIN_ATTEMPTS = 10;
export const MIN_OPTION_DISTRIBUTION_ATTEMPTS = 5;
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
      typeof row.selected_answer !== "string" || !/^[A-E]$/i.test(row.selected_answer)) return null;
    // A single payload may not replace its first answer with a later one.
    if (!seen.has(row.question_id)) result.push({ question_id: row.question_id, selected_answer: row.selected_answer.toUpperCase() });
    seen.add(row.question_id);
  }
  return result;
}

export const INSERT_FIRST_ANSWERS_SQL = `
  INSERT INTO question_answer_stats (user_id, question_id, is_correct, selected_answer)
  SELECT $1, q.id, UPPER(BTRIM(q.answer)) = submitted.selected_answer, submitted.selected_answer
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

// Only aggregate counts leave SQL. No answer key or per-user records are read.
export const OPTION_DISTRIBUTION_SQL = `
  SELECT choices.letter, COUNT(s.id)::int AS count
  FROM questions q
  JOIN question_sets qs ON qs.id = q.question_set_id
  CROSS JOIN LATERAL (VALUES ('A',q.option_a),('B',q.option_b),
    ('C',q.option_c),('D',q.option_d),('E',q.option_e)) AS choices(letter,content)
  LEFT JOIN question_answer_stats s ON s.question_id = q.id
    AND s.selected_answer IS NOT NULL AND s.selected_answer = choices.letter
  WHERE q.id = $1 AND qs.visibility = 'public'
    AND NULLIF(BTRIM(choices.content), '') IS NOT NULL
  GROUP BY choices.letter ORDER BY choices.letter
`;

export async function optionDistribution(query: Query, questionId: number) {
  const rows = await query(OPTION_DISTRIBUTION_SQL, [questionId]);
  if (!rows.length) return null;
  const total = rows.reduce((sum, row) => sum + Number(row.count), 0);
  const sufficient = total >= MIN_OPTION_DISTRIBUTION_ATTEMPTS;
  return {
    total, sufficient, min_attempts: MIN_OPTION_DISTRIBUTION_ATTEMPTS,
    options: sufficient ? rows.map((row) => ({
      letter: String(row.letter), count: Number(row.count),
      percentage: Math.round(Number(row.count) / total * 1000) / 10,
    })) : [],
  };
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

// Calendar week in Taiwan; each stored row is one user's first answer.
export async function weeklyMostMissed(query: Query) {
  return query(`
    SELECT q.id AS question_id, q.question_number, qs.exam_year,
      q.subject AS exam_subject, q.question,
      COUNT(*)::int AS total_attempts,
      COUNT(*) FILTER (WHERE NOT s.is_correct)::int AS wrong_attempts
    FROM question_answer_stats s
    JOIN questions q ON q.id = s.question_id
    JOIN question_sets qs ON qs.id = q.question_set_id
    WHERE qs.visibility = 'public'
      AND s.created_at >= (DATE_TRUNC('week', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')
      AND s.created_at <= CURRENT_TIMESTAMP
    GROUP BY q.id, qs.exam_year
    HAVING COUNT(*) >= $1 AND COUNT(*) FILTER (WHERE NOT s.is_correct) > 0
    ORDER BY wrong_attempts DESC, total_attempts DESC, q.id ASC
    LIMIT 1
  `, [MIN_ATTEMPTS]);
}
