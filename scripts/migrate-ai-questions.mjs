import { readFileSync } from 'node:fs';
import pg from 'pg';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
if (!process.argv.includes('--apply')) {
  console.log('Dry run: additive migration only. Review migrations/20261009_ai_question_bank.sql, then run node scripts/migrate-ai-questions.mjs --apply against the intended DATABASE_URL.');
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  await client.connect(); await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query(readFileSync(new URL('../migrations/20261009_ai_question_bank.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT'); console.log('AI question bank migration applied; existing tables unchanged.');
} catch { await client.query('ROLLBACK').catch(() => {}); console.error('AI migration failed; transaction rolled back.'); process.exitCode = 1; }
finally { await client.end(); }
