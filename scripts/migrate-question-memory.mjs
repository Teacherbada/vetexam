import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nextEnv from '@next/env';
import pg from 'pg';

nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const sql = readFileSync(new URL('../migrations/20260925_question_memory_state.sql', import.meta.url), 'utf8');
async function migrate(apply) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await client.query('SET LOCAL search_path=public,pg_temp');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  const counts = async () => (await client.query(`SELECT
    (SELECT COUNT(*) FROM "user") AS users, (SELECT COUNT(*) FROM questions) AS questions,
    (SELECT COUNT(*) FROM practice_attempts) AS attempts,
    (SELECT COUNT(*) FROM question_answer_stats) AS first_answers,
    (SELECT COUNT(*) FROM study_plans) AS study_plans,
    (SELECT COUNT(*) FROM diagnostic_items) AS diagnostic_items,
    (SELECT COUNT(*) FROM custom_plans) AS custom_plans`)).rows[0];
  const before = await counts();
  await client.query(sql);
  const memoryBefore = (await client.query('SELECT COUNT(*) AS count FROM question_memory_state')).rows[0];
  await client.query(sql);
  assert.deepEqual((await client.query('SELECT COUNT(*) AS count FROM question_memory_state')).rows[0], memoryBefore);
  assert.deepEqual(await counts(), before);
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ result:apply ? 'applied' : 'dry-run rolled back', preserved:before, memory:memoryBefore.count }));
}
try {
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  await client.connect();
  await migrate(false);
  if (process.argv.includes('--apply')) await migrate(true);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Memory migration failed; rolled back.', error.code ?? 'configuration/count verification');
  process.exitCode = 1;
} finally { await client.end(); }
