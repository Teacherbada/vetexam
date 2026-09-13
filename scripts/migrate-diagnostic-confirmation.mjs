import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nextEnv from '@next/env';
import pg from 'pg';
nextEnv.loadEnvConfig(process.cwd());
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query('LOCK TABLE diagnostic_sessions, diagnostic_items IN ACCESS EXCLUSIVE MODE');
  const counts = async () => (await client.query('SELECT (SELECT count(*) FROM diagnostic_sessions)::int AS sessions, (SELECT count(*) FROM diagnostic_items)::int AS items')).rows[0];
  const before = await counts();
  const migration = readFileSync(new URL('../migrations/20260915_diagnostic_confirmation.sql', import.meta.url), 'utf8');
  await client.query(migration);
  await client.query(migration);
  assert.deepEqual(await counts(), before);
  console.log('Session/item counts preserved:', JSON.stringify(before));
  await client.query(process.argv.includes('--apply') ? 'COMMIT' : 'ROLLBACK');
  console.log(process.argv.includes('--apply') ? 'Confirmation migration applied.' : 'Confirmation migration dry run passed; rolled back.');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('Confirmation migration failed; no partial changes committed.', error.code ?? 'configuration/validation error');
  process.exitCode = 1;
} finally { await client.end(); }
