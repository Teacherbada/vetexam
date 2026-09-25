import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nextEnv from '@next/env';
import pg from 'pg';

nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SET LOCAL search_path=public,pg_temp');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  const counts = async () => (await client.query('SELECT (SELECT COUNT(*) FROM "user")::int AS users, (SELECT COUNT(*) FROM questions)::int AS questions, (SELECT COUNT(*) FROM question_answer_stats)::int AS first_answers, (SELECT COUNT(*) FROM diagnostic_items)::int AS diagnostic_items, (SELECT COUNT(*) FROM custom_plans)::int AS custom_plans')).rows[0];
  const before = await counts();
  const sql = readFileSync(new URL('../migrations/20260925_account_learning.sql', import.meta.url), 'utf8');
  await client.query(sql);
  await client.query(sql);
  assert.deepEqual(await counts(), before);
  console.log('Existing data counts preserved:', JSON.stringify(before));
  await client.query(process.argv.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
  console.log(process.argv.includes('--apply') ? 'Account learning migration applied.' : 'Account learning migration dry run passed; rolled back.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Account learning migration failed; rolled back.', error.code ?? 'configuration', error.code ? error.message : 'Check configuration or unchanged counts.');
  process.exitCode = 1;
} finally {
  await client.end();
}
