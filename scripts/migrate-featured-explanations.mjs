// Deployment order: publish the fail-closed readers, then run this additive
// migration. Existing text is never rewritten or automatically published.
// Recovery: retain these columns and deploy a compatible repair. Do NOT roll
// back to code that reads explanation without checking its publication status.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import pg from 'pg';
import nextEnv from '@next/env';

if (!process.argv.includes('--apply')) {
  console.log('Plan only: add explanation_status=draft and explanation_version=0; preserve all bodies. No database connection.');
  console.log('After deploying protected readers: node scripts/migrate-featured-explanations.mjs --apply --confirm-draft-migration --backup .tmp/featured-explanations-before.json');
  process.exit(0);
}
const backupArg = process.argv[process.argv.indexOf('--backup') + 1];
if (!process.argv.includes('--confirm-draft-migration') || !process.argv.includes('--backup') || !backupArg || backupArg.startsWith('--')) throw Error('Explicit draft migration confirmation and a backup path are required');
const backup = resolve(backupArg), within = relative(resolve('.tmp'), backup);
if (!within || within.startsWith('..') || isAbsolute(within)) throw Error('Backup must be a new file within this worktree .tmp directory');
nextEnv.loadEnvConfig(process.env.VETEXAM_ENV_DIR || process.cwd(), false, { info() {}, error() {} });
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
const protectedRows = `SELECT id,md5((to_jsonb(q)-'explanation_status'-'explanation_version')::text) AS hash FROM questions q ORDER BY id`;
try {
  await client.connect(); await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query("SET LOCAL statement_timeout='30s'");
  await client.query('LOCK TABLE questions IN ACCESS EXCLUSIVE MODE');
  const before = (await client.query(protectedRows)).rows;
  const explanations = (await client.query(`SELECT id,question_set_id,explanation,
    to_jsonb(q)->>'explanation_status' AS explanation_status,
    to_jsonb(q)->>'explanation_version' AS explanation_version FROM questions q ORDER BY id`)).rows;
  mkdirSync(dirname(backup), { recursive: true });
  writeFileSync(backup, JSON.stringify({ createdAt: new Date().toISOString(), protectedRows: before, explanations }, null, 2), { flag: 'wx', mode: 0o600 });
  await client.query(readFileSync(new URL('../migrations/20261014_featured_explanations.sql', import.meta.url), 'utf8'));
  if (JSON.stringify((await client.query(protectedRows)).rows) !== JSON.stringify(before)) throw Error('Protected question data changed; refusing commit');
  await client.query('COMMIT');
  console.log(JSON.stringify({ applied: true, preservedQuestions: before.length, backup, autoPublished: 0 }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Featured explanation migration failed; rolled back.', error.code || error.name);
  process.exitCode = 1;
} finally { await client.end(); }
