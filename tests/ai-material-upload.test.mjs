import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {test} from 'node:test';
import ts from 'typescript';
import pg from 'pg';
import nextEnv from '@next/env';
import {diagnosticTestConnectionString} from './diagnostic-database.mjs';
import {makePDF,sourceText} from './ai-material-fixtures.mjs';
const require=createRequire(import.meta.url);
function load(path,mocks={}){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(name==='server-only')return {};if(name in mocks)return mocks[name];if(name.startsWith('node:'))return require(name);if(name==='pdfjs-dist/legacy/build/pdf.mjs')return import(name);throw Error('Unexpected '+name);},exports);return exports;}
const taxonomy=load('data/exam-chapters.ts'),input=load('lib/ai-question-input.ts',{'@/data/exam-chapters':taxonomy});
const config=load('lib/ai-material-input.ts',{'@/data/exam-chapters':taxonomy,'./ai-question-input':input});
const signing=load('lib/admin-questions.ts',{'./admin-question-input':load('lib/admin-question-input.ts')});
const pdf=load('lib/ai-material-pdf.ts',{'./ai-material-input':config});
const questions=load('lib/ai-question-service.ts',{'./ai-question-input':input,'./admin-questions':signing});
const materialService=load('lib/ai-material-service.ts',{'./question-transaction':{},'./admin-questions':signing,'./ai-question-input':input,'./ai-question-service':questions,'./ai-material-input':config,'./ai-material-model':{}});
function uploader(tx){return load('lib/ai-material-upload.ts',{'./admin-questions':signing,'./ai-question-input':input,'./ai-material-input':config,'./question-transaction':{questionTransaction:tx},'./ai-material-pdf':pdf,'./ai-material-service':materialService});}
function largePDF(size){
 const small=makePDF([sourceText]),offset=small.indexOf('\nxref\n')+1,tail=small.subarray(offset).toString();let padding=size-small.length;
 for(let i=0;i<5;i++){const length=tail.replace(/startxref\n\d+/, 'startxref\n'+(offset+padding)).length-tail.length;padding=size-small.length-length;}
 const gap=Buffer.alloc(padding,32);gap[0]=37;gap[gap.length-1]=10;
 const bytes=Buffer.concat([small.subarray(0,offset),gap,Buffer.from(tail.replace(/startxref\n\d+/,'startxref\n'+(offset+padding)))]);assert.equal(bytes.length,size);return bytes;
}
const maximum=100*1024*1024;
test('real 100 MB PDF extracts text without AI; server rejects over-limit bytes; generation budget remains fixed',async()=>{
 assert.equal(config.MATERIAL_LIMITS.maxFileBytes,maximum);assert.equal(config.MATERIAL_LIMITS.maxQuestions,10);assert.equal(config.MATERIAL_LIMITS.maxSourceBytes,18000);assert.equal(config.MATERIAL_LIMITS.batchMicroUSD,200000);assert.equal(config.MATERIAL_LIMITS.dailyMicroUSD,2000000);assert.equal(config.MATERIAL_LIMITS.retries,0);
 const pages=await pdf.extractMaterialPDF(new Uint8Array(largePDF(maximum)));assert.equal(pages.length,1);assert(pages[0].usable);assert(pages[0].text.includes('100 animals'));
 const tooBig=new Uint8Array(maximum+1);tooBig.set(Buffer.from('%PDF-'));await assert.rejects(pdf.extractMaterialPDF(tooBig),/100 MB/);
});
test('100 MB client splits into bounded requests and resumes acknowledged chunks; no generation action',async()=>{
 const id=randomUUID(),file=new File([largePDF(maximum)],'large.pdf');let calls=0,parts=0,finish=0,largest=0;
 const client=load('lib/ai-material-upload-client.ts',{'./ai-material-input':config,'./ai-question-client':{fetchAI:async(_url,init)=>{
  calls++;largest=Math.max(largest,Buffer.byteLength(init.body));const b=JSON.parse(init.body);assert(['begin','chunk','finish'].includes(b.action));
  if(b.action==='begin'){assert.equal(b.size,maximum);return Response.json({status:'uploading',received:[0,1],chunkBytes:1048576});}
  if(b.action==='chunk'){parts++;assert(b.position>=2&&b.position<100);assert.equal(Buffer.from(b.data,'base64').length,1048576);return Response.json({received:b.position});}
  finish++;return Response.json({material:{id}});
 }}});
 assert.equal((await client.uploadLargeMaterial(file,id,()=>{})).material.id,id);assert.equal(parts,98);assert.equal(finish,1);assert.equal(calls,100);assert(largest<2*1024*1024);
 await assert.rejects(client.uploadLargeMaterial({size:maximum+1},id,()=>{}),/100 MB/);
});
test('chunk-upload endpoint denies a member before parsing body or reading storage',async()=>{
 let accesses=0;const route=load('app/api/admin/ai-materials/upload/route.ts',{'@/lib/admin':{requireAdmin:async()=>null},'@/lib/ai-question-http':{aiJson:(body,status=200)=>Response.json(body,{status}),readAIBody:()=>{accesses++;}},'@/lib/question-transaction':{},'@/lib/ai-material-upload':{},'@/lib/ai-question-input':input});
 for(const action of ['begin','chunk','finish'])assert.equal((await route.POST(new Request('https://test.local/api/admin/ai-materials/upload',{method:'POST',body:JSON.stringify({action})}))).status,403);assert.equal(accesses,0);
});
test('PostgreSQL: chunk identity, owner, missing segments, claim exclusion, complete PDF storage and replay',{skip:process.env.AI_QUESTIONS_DB_TEST!=='1'},async()=>{
 nextEnv.loadEnvConfig(process.cwd());const c=new pg.Client({connectionString:diagnosticTestConnectionString(),connectionTimeoutMillis:10000});await c.connect();
 try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='15s'");const schema='ai_upload_'+randomUUID().replaceAll('-','');await c.query('CREATE SCHEMA '+schema);await c.query('SET LOCAL search_path TO '+schema);
  for(const name of ['20261009_ai_question_bank.sql','20261010_ai_material_generation.sql','20261011_ai_material_uploads.sql','20261011_ai_material_uploads.sql'])await c.query(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const bytes=largePDF(process.env.AI_UPLOAD_100MB_DB_TEST==='1'?maximum:4*1024*1024+37),id=randomUUID(),body={id,filename:'large.pdf',size:bytes.length};const service=uploader(run=>run(c));
  await service.beginMaterialUpload(c,body,'admin');assert.equal((await service.beginMaterialUpload(c,body,'admin')).id,id);
  await assert.rejects(service.beginMaterialUpload(c,{...body,size:maximum+1},'admin'),/100 MB/);
  await assert.rejects(service.beginMaterialUpload(c,body,'member'),/不符/);
  await assert.rejects(service.claimMaterialUpload(c,id,'admin'),/完整/);
  for(let position=0;position<Math.ceil(bytes.length/1048576);position++){
   const data=bytes.subarray(position*1048576,(position+1)*1048576).toString('base64');await service.putMaterialChunk(c,{id,position,data},'admin');
   if(position===0){assert.equal((await service.putMaterialChunk(c,{id,position,data},'admin')).replayed,true);await assert.rejects(service.putMaterialChunk(c,{id,position,data:Buffer.alloc(1048576,32).toString('base64')},'admin'));await assert.rejects(service.putMaterialChunk(c,{id,position,data},'member'),/不存在/);}
  }
  const claimed=await service.claimMaterialUpload(c,id,'admin');assert.equal(claimed.byteLength,bytes.length);
  await assert.rejects(service.claimMaterialUpload(c,id,'admin'),/正在/);
  await c.query("UPDATE ai_material_uploads SET status='uploading',claim=NULL WHERE id=$1",[id]);
  const done=await service.finishMaterialUpload(id,'admin');assert(done.material.pages[0].usable);assert.equal((await service.finishMaterialUpload(id,'admin')).material.id,done.material.id);
  const stored=(await c.query('SELECT octet_length(pdf) AS n,fingerprint,encode(sha256(pdf),\'hex\') AS actual_hash FROM ai_materials')).rows[0];assert.equal(stored.n,bytes.length);assert.equal(stored.fingerprint,createHash('sha256').update(bytes).digest('hex'));assert.equal(stored.actual_hash,stored.fingerprint);assert.equal((await c.query('SELECT count(*)::int AS n FROM ai_material_upload_chunks')).rows[0].n,0);assert.equal((await c.query('SELECT count(*)::int AS n FROM ai_generation_jobs')).rows[0].n,0);
 }finally{await c.query('ROLLBACK');await c.end();}
});
