import 'server-only';
import type { PoolClient } from 'pg';

// Imported browser archives can contain formerly public explanations. Preserve
// the archive itself, but resolve its public question explanations at read time.
export async function publicLegacyExplanations(client: Pick<PoolClient, 'query'>, payloads: Record<string, unknown>[]) {
  const ids = new Set<number>();
  for (const payload of payloads) for (const key of ['favorites', 'wrongQuestions']) {
    if (Array.isArray(payload[key])) for (const row of payload[key]) {
      if (row && typeof row === 'object' && Number.isInteger(Number(row.id)) && Number(row.id) > 0 && Number(row.id) <= 2147483647) ids.add(Number(row.id));
    }
  }
  if (!ids.size) return payloads;
  const { rows } = await client.query(`SELECT q.id,
    CASE WHEN to_jsonb(q)->>'explanation_status'='published' THEN COALESCE(q.explanation,'') ELSE '' END AS explanation
    FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
    WHERE qs.visibility='public' AND q.id=ANY($1::integer[])`, [[...ids]]);
  const explanations = new Map(rows.map(row => [row.id, row.explanation]));
  return payloads.map(payload => {
    const copy = { ...payload };
    for (const key of ['favorites', 'wrongQuestions']) if (Array.isArray(copy[key])) {
      copy[key] = copy[key].map(row => row && explanations.has(Number(row.id)) ? { ...row, explanation: explanations.get(Number(row.id)) } : row);
    }
    return copy;
  });
}
