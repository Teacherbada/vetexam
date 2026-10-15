import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import nextEnv from '@next/env';
import pg from 'pg';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2);
const sql=await readFile(resolve(root,'migrations/20261014_question_proofreading.sql'),'utf8');
if(!args.includes('--apply')){console.log('Plan only. Adds proofreading metadata/history; expands the existing answer parser to A–E. No existing rows change.');console.log(sql);process.exit(0);}
function argument(name){const i=args.indexOf(name);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing '+name);return args[i+1];}
if(!args.includes('--preserve-existing'))throw Error('--preserve-existing is required');
const backup=resolve(root,argument('--backup')),allowed=resolve(root,'.tmp');
if(!backup.startsWith(allowed+'\\')&&!backup.startsWith(allowed+'/'))throw Error('Backup must stay within this worktree .tmp');
nextEnv.loadEnvConfig(args.includes('--env-dir')?resolve(argument('--env-dir')):root,false,{info(){},error(){}});
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const tables=['questions','question_sets','question_answer_stats','practice_attempts','diagnostic_items'];
async function digest(){const result={};for(const table of tables)result[table]=(await db.query(`SELECT count(*)::int AS count,md5(COALESCE(string_agg(hash,'' ORDER BY hash),'')) AS digest FROM (SELECT md5(to_jsonb(q)::text) hash FROM ${table} q) hashes`)).rows[0];return result;}
try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
 const columns=(await db.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='questions' AND column_name IN ('answer','image_data_url','option_e','explanation_status','explanation_version') ORDER BY column_name")).rows;
 if(columns.length!==5||columns.some(c=>c.data_type!==(c.column_name==='explanation_version'?'bigint':'text')))throw Error('Unexpected production schema; manual review required');
 const parser=(await db.query("SELECT pg_get_functiondef('vetexam_answer_keys(text)'::regprocedure) AS definition")).rows[0].definition;
 const before=await digest(),snapshot={createdAt:new Date().toISOString(),columns,parser,before,metadata:{}};
 for(const table of ['question_proofreading','question_edit_history','question_bank_proofreading']){
  const exists=(await db.query('SELECT to_regclass($1) AS name',[table])).rows[0].name;
  snapshot.metadata[table]=exists?(await db.query(`SELECT * FROM ${table}`)).rows:null;
 }
 await mkdir(dirname(backup),{recursive:true});await writeFile(backup,JSON.stringify(snapshot,null,2),{flag:'wx'});
 await db.query(sql);const after=await digest();if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Original data changed; abort');
 const check=(await db.query("SELECT vetexam_answer_keys('C') AS legacy,vetexam_answer_keys('[\"A\",\"E\"]') AS multiple")).rows[0];
 if(JSON.stringify(check)!==JSON.stringify({legacy:['C'],multiple:['A','E']}))throw Error('Answer parser verification failed');
 await db.query('COMMIT');console.log(JSON.stringify({applied:true,originalRowsUnchanged:true,counts:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,v.count])),backup},null,2));
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error('Migration rolled back:',e.code||e.message);process.exitCode=1;}finally{await db.end();}
