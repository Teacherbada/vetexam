import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import nextEnv from '@next/env';import pg from 'pg';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),sql=await readFile(resolve(root,'migrations/20261017_coach_daily_plan.sql'),'utf8');
if(!args.includes('--apply')){console.log('Plan only: one nullable JSONB column. No database connection or existing record update.\n'+sql);process.exit(0);}
function argument(name){const i=args.indexOf(name);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing '+name);return args[i+1];}
const backup=resolve(root,argument('--backup')),allowed=resolve(root,'.tmp');if(!backup.startsWith(allowed+'/')&&!backup.startsWith(allowed+'\\'))throw Error('Backup must stay within worktree .tmp');
nextEnv.loadEnvConfig(args.includes('--env-dir')?resolve(argument('--env-dir')):root,false,{info(){},error(){}});
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query("SET LOCAL search_path=public;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s'");
 const column=(await db.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='daily_tasks' AND column_name='coach_plan'")).rows[0];
 if(column&&column.data_type!=='jsonb')throw Error('Unexpected coach_plan type');
 const tables=['study_plans','daily_tasks','daily_task_items','diagnostic_sessions','diagnostic_items'],snapshot={createdAt:new Date().toISOString(),tables:{}};
 for(const table of tables)snapshot.tables[table]=(await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t`)).rows.map(r=>r.row);
 await mkdir(dirname(backup),{recursive:true});await writeFile(backup,JSON.stringify(snapshot),{flag:'wx'});
 await db.query(sql);
 for(const table of tables){const after=(await db.query(`SELECT to_jsonb(t)${table==='daily_tasks'&&!column?" - 'coach_plan'":''} AS row FROM ${table} t`)).rows.map(r=>JSON.stringify(r.row)).sort();
  if(JSON.stringify(after)!==JSON.stringify(snapshot.tables[table].map(r=>JSON.stringify(r)).sort()))throw Error('Existing records changed: '+table);}
 await db.query('COMMIT');console.log(JSON.stringify({applied:true,existingRowsUnchanged:true,backup}));
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error('Rolled back:',e.code||e.message);process.exitCode=1;}finally{await db.end();}
