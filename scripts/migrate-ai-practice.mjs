import {readFileSync} from 'node:fs';
import pg from 'pg';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const files=['20261011_ai_practice_isolation.sql','20261011_ai_material_uploads.sql'];
if(!process.argv.includes('--apply')){console.log('Dry run: review '+files.join(', ')+'; run with --apply against the intended DATABASE_URL.');process.exit(0);}
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
try{
 await client.connect();await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='5s'");
 for(const name of files)await client.query(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 await client.query('COMMIT');console.log('AI type isolation and 100 MB upload migrations applied; original rows retained.');
}catch{await client.query('ROLLBACK').catch(()=>{});console.error('Migration failed and rolled back.');process.exitCode=1;}finally{await client.end();}
