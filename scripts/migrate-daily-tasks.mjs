import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import nextEnv from '@next/env';
import pg from 'pg';
nextEnv.loadEnvConfig(process.cwd());
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try {
  await client.connect();await client.query('BEGIN');await client.query('SET LOCAL search_path=public,pg_temp');
  await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='30s'");
  await client.query('LOCK TABLE study_plans,diagnostic_sessions,diagnostic_items,chapter_follow_ups IN ACCESS EXCLUSIVE MODE');
  const counts=async()=>(await client.query('SELECT (SELECT COUNT(*) FROM study_plans)::int AS plans,(SELECT COUNT(*) FROM diagnostic_sessions)::int AS sessions,(SELECT COUNT(*) FROM diagnostic_items)::int AS items,(SELECT COUNT(*) FROM chapter_follow_ups)::int AS follow_ups')).rows[0];
  const before=await counts();
  const sql=readFileSync(new URL('../migrations/20260918_daily_tasks.sql',import.meta.url),'utf8');
  await client.query(sql);await client.query(sql);assert.deepEqual(await counts(),before);
  console.log('Existing data counts preserved:',JSON.stringify(before));
  await client.query(process.argv.includes('--apply')?'COMMIT':'ROLLBACK');
  console.log(process.argv.includes('--apply')?'Daily-task migration applied.':'Daily-task migration dry run passed; rolled back.');
} catch(error) {
  await client.query('ROLLBACK').catch(()=>{});console.error('Daily-task migration failed; rolled back.',error.code??'configuration',error.code?error.message:'Check configuration.');process.exitCode=1;
} finally {await client.end();}
