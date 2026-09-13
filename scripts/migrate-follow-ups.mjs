import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import nextEnv from '@next/env';
import ts from 'typescript';
import pg from 'pg';
nextEnv.loadEnvConfig(process.cwd());
const config = {};
new Function('exports', ts.transpileModule(readFileSync(new URL('../lib/follow-up-config.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(config);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect(); await client.query('BEGIN');
  await client.query('SET LOCAL search_path = public, pg_temp');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query('LOCK TABLE study_plans, reinforcement_tasks, diagnostic_sessions, diagnostic_items IN ACCESS EXCLUSIVE MODE');
  const counts = async () => (await client.query('SELECT (SELECT COUNT(*) FROM reinforcement_tasks)::int AS tasks,(SELECT COUNT(*) FROM diagnostic_sessions)::int AS sessions,(SELECT COUNT(*) FROM diagnostic_items)::int AS items')).rows[0];
  const before = await counts();
  const migration = readFileSync(new URL('../migrations/20260917_follow_ups.sql', import.meta.url), 'utf8');
  await client.query(migration); await client.query(migration);
  const { rows } = await client.query("SELECT * FROM reinforcement_tasks WHERE status='short_term' AND verification_completed_at IS NOT NULL");
  for (const row of rows) await client.query(`INSERT INTO chapter_follow_ups(id,user_id,subject,chapter,reinforcement_task_id,review_attempt,stage,due_at,intervals)
    VALUES ($1,$2,$3,$4,$5,$6,1,$7::timestamptz + ($8 * interval '24 hours'),$9::jsonb) ON CONFLICT DO NOTHING`,
  [randomUUID(),row.user_id,row.subject,row.chapter,row.id,row.review_count,row.verification_completed_at,config.FOLLOW_UP_INTERVALS_DAYS[0],JSON.stringify(config.FOLLOW_UP_INTERVALS_DAYS)]);
  assert.deepEqual(await counts(), before);
  console.log('Existing counts preserved:', JSON.stringify(before), 'eligible historical tasks:', rows.length);
  await client.query(process.argv.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
  console.log(process.argv.includes('--apply') ? 'Follow-up migration applied.' : 'Follow-up migration dry run passed; rolled back.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Follow-up migration failed; rolled back.', error.code ?? 'configuration', error.code ? error.message : 'Check configuration.'); process.exitCode = 1;
} finally { await client.end(); }
