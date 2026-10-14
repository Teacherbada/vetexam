import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import nextEnv from '@next/env';
import pg from 'pg';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const sql=await readFile(resolve(root,'migrations/20261014_multiple_official_answers.sql'),'utf8');
if(!args.includes('--apply')){
 console.log('Plan only: add two answer parser functions and widen diagnostic_items_answer_key_check. No row values change.');
 console.log('Apply requires --apply --preserve-existing --backup .tmp/<new-file>.json [--env-dir <existing env directory>].');
 console.log(sql);process.exit(0);
}
const option=name=>args[args.indexOf(name)+1];
if(!args.includes('--preserve-existing')||!args.includes('--backup'))throw Error('Explicit preservation and backup arguments required');
const backup=resolve(root,option('--backup')),allowed=resolve(root,'.tmp');
if(!backup.startsWith(allowed+'\\')&&!backup.startsWith(allowed+'/'))throw Error('Backup must be within this worktree .tmp');
nextEnv.loadEnvConfig(args.includes('--env-dir')?resolve(option('--env-dir')):root,false,{info(){},error(){}});
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required');
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
const tables=['questions','question_sets','question_answer_stats','diagnostic_items','practice_attempts'];
async function digests(){const result={};for(const table of tables){result[table]=(await client.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(hash,'' ORDER BY hash),'')) AS digest FROM (SELECT md5(to_jsonb(t)::text) AS hash FROM ${table} t) hashed_rows`)).rows[0];}return result;}
try{
 await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
 await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
 const columns=(await client.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND ((table_name='questions' AND column_name='answer') OR (table_name='diagnostic_items' AND column_name='answer_key'))")).rows;
 if(columns.length!==2||columns.some(c=>c.data_type!=='text'))throw Error('Unexpected answer schema; no changes applied');
 const constraint=(await client.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='diagnostic_items'::regclass AND contype='c' AND conname='diagnostic_items_answer_key_check'")).rows;
 if(constraint.length!==1)throw Error('Expected answer-key constraint missing; manual review required');
 const before=await digests();
 const snapshot={createdAt:new Date().toISOString(),columns,constraint,before,
  questions:(await client.query('SELECT id,answer FROM questions ORDER BY id')).rows,
  coachKeys:(await client.query('SELECT session_id,position,answer_key FROM diagnostic_items ORDER BY session_id,position')).rows};
 await mkdir(dirname(backup),{recursive:true});await writeFile(backup,JSON.stringify(snapshot,null,2),{flag:'wx'});
 await client.query(sql);
 const after=await digests();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Stored row digest changed; rolling back');
 const check=await client.query("SELECT vetexam_answer_keys('C') AS legacy,vetexam_answer_keys('[\"A\",\"B\"]') AS multiple,vetexam_has_answer('[\"A\",\"B\"]',ARRAY['a','b','c','d']) AS usable");
 if(JSON.stringify(check.rows[0])!==JSON.stringify({legacy:['C'],multiple:['A','B'],usable:true}))throw Error('Parser smoke check failed');
 await client.query('COMMIT');console.log(JSON.stringify({applied:true,allOriginalRowsUnchanged:true,counts:Object.fromEntries(Object.entries(after).map(([name,value])=>[name,value.count])),backup},null,2));
}catch(error){await client.query('ROLLBACK').catch(()=>{});console.error('Migration rolled back:',error.code||error.message);process.exitCode=1;}
finally{await client.end();}
