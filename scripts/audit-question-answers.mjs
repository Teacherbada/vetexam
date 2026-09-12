import nextEnv from '@next/env';
import pg from 'pg';
nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const schema = await client.query("SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('questions','question_sets','question_answer_stats') ORDER BY table_name,ordinal_position");
  const counts = await client.query(`SELECT qs.visibility,COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE q.answer IS NULL)::int AS answer_null,
    COUNT(*) FILTER (WHERE q.answer IS NOT NULL AND BTRIM(q.answer)='')::int AS answer_blank,
    COUNT(*) FILTER (WHERE NULLIF(BTRIM(q.answer),'') IS NOT NULL AND UPPER(BTRIM(q.answer)) !~ '^[A-D]$')::int AS answer_non_abcd,
    COUNT(*) FILTER (WHERE NULLIF(BTRIM(q.option_e),'') IS NOT NULL)::int AS fifth_option,
    COUNT(*) FILTER (WHERE NULLIF(BTRIM(q.explanation),'') IS NULL)::int AS missing_explanation
    FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id GROUP BY qs.visibility`);
  const stats = await client.query('SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE selected_answer IS NULL)::int AS missing_selected_answer FROM question_answer_stats');
  const duplicates = await client.query('SELECT COUNT(*)::int AS duplicate_numbers FROM (SELECT question_set_id,question_number FROM questions GROUP BY question_set_id,question_number HAVING COUNT(*)>1) d');
  console.log(JSON.stringify({ schema: schema.rows, counts: counts.rows, statistics: stats.rows, duplicates: duplicates.rows }, null, 2));
} catch (error) { console.error('Read-only audit failed:', error.code || error.name); process.exitCode = 1; }
finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
