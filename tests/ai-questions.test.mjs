import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import pg from 'pg';
import nextEnv from '@next/env';
import { diagnosticTestConnectionString } from './diagnostic-database.mjs';
const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require','exports',code)(name => {
    if (name === 'server-only') return {};
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error('Unexpected import ' + name);
  },exports);
  return exports;
}
const taxonomy = load('data/exam-chapters.ts');
const input = load('lib/ai-question-input.ts', { '@/data/exam-chapters': taxonomy });
const adminInput = load('lib/admin-question-input.ts');
const signing = load('lib/admin-questions.ts', { './admin-question-input': adminInput });
const service = load('lib/ai-question-service.ts', { './ai-question-input': input, './admin-questions': signing });
const adminHttp = load('lib/admin-question-http.ts', { 'next/server': { NextResponse: { json: (body,init) => Response.json(body,init) } }, './admin-questions': signing });
const http = load('lib/ai-question-http.ts', { './admin-questions': signing, './admin-question-http': adminHttp });
const example = JSON.parse(readFileSync(new URL('../public/examples/ai-questions.json',import.meta.url)));
const q = () => structuredClone(example.questions[0]);
test('example uses fixed taxonomy and actual supplied sample excerpt; unknown pages stay unconfirmed', () => {
  const parsed = input.parseAIQuestion(q());
  assert.deepEqual(parsed.errors, []); assert.equal(parsed.warnings.length,2);
  assert.equal(parsed.question.source.printedPages,''); assert.equal(parsed.question.source.pdfPages,'');
  const source = readFileSync(new URL('../public/examples/ai-source.txt',import.meta.url),'utf8');
  assert(source.includes(q().source.excerpt));
});
test('reject incomplete fields, fake taxonomy, invalid keys, forged review flags, unsafe URLs and ambiguous options', () => {
  const invalid = [
    { subject:'新科目' }, { chapter:'新章節' }, { chapter:'' }, { question:'' }, { explanation:'' }, { options:['a','b','c'] },
    { options:['a','a','c','d'] }, { options:['a',null,'c','d'] }, { answer:'AB' }, { answer:'E' },
    { optionExplanations:['a'] }, { optionExplanations:[{},null,1,'x'] }, { generationMethod:'' }, { status:'published' },
    { source:{ ...q().source, excerpt:'' } }, { source:{ ...q().source, title:'' } },
    { source:{ ...q().source, chapter:'', printedPages:'',pdfPages:'' } },
    { source:{ ...q().source, url:'javascript:alert(1)' } }, { source:{ ...q().source, url:'https://user:pass@example.com/' } },
  ];
  for (const patch of invalid) assert(input.parseAIQuestion({...q(),...patch}).errors.length,JSON.stringify(patch));
  assert.equal(input.parseAIQuestion({...q(),source:{...q().source,chapter:'',pdfPages:'12'}}).errors.length,0);
  assert.throws(()=>input.parseAIBatch({name:'x',questions:[]})); assert.throws(()=>input.parseAIBatch({name:'x',questions:Array(201).fill(q())}));
});
test('preview reports every invalid row and duplicates across batch/database without silently dropping', async () => {
  const existing = {...q(),question:'existing'};
  const preview = await service.previewAI(async()=>[{fingerprint:service.aiFingerprint(existing)}], {name:'test',questions:[q(),q(),{...q(),answer:'Z'},existing,null]});
  assert.equal(preview.preview.rows.length,5); assert.equal(preview.preview.valid,1); assert.equal(preview.preview.invalid,4);
  assert(preview.preview.rows[1].errors.some(e=>e.includes('重複')));
});
test('admin endpoints deny guest/member before body or database, member endpoint requires login', async () => {
  let allowed=false, user=null, calls=0;
  const mocks={
    '@/lib/admin':{requireAdmin:async()=>allowed?{session:{user:{id:'admin'}},sql:{query:async()=>{calls++;return [];}}}:null},
    '@/lib/question-transaction':{questionTransaction:async()=>{calls++;throw Error('Unexpected DB');}},
    '@/lib/ai-question-service':service,'@/lib/ai-question-http':http,'@/lib/ai-question-input':input,
    '@/data/exam-chapters':taxonomy,'@/lib/auth':{auth:{api:{getSession:async()=>user?{user:{id:user}}:null}}},
    '@neondatabase/serverless':{neon:()=>{calls++;throw Error('Unexpected DB');}},
  };
  const admin=load('app/api/admin/ai-questions/route.ts',mocks), member=load('app/api/ai-questions/route.ts',mocks);
  const request=(body,origin='https://vetexam.test')=>new Request('https://vetexam.test/api/admin/ai-questions',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
  for(const identity of [null,'member']) {user=identity;assert.equal((await admin.GET(new Request('https://vetexam.test/api/admin/ai-questions'))).status,403);
    for(const action of ['preview','import','save','publish','unpublish']) assert.equal((await admin.POST(request({action,isAdmin:true}))).status,403);}
  user=null; assert.equal((await member.GET(new Request('https://vetexam.test/api/ai-questions'))).status,401); assert.equal((await member.POST(request({}))).status,401);
  assert.equal(calls,0); allowed=true;
  assert.equal((await admin.POST(request({},'https://evil.test'))).status,403);
  assert.equal((await admin.POST(request({padding:'a'.repeat(2*1024*1024)}))).status,413);
  assert.equal(calls,0);
});
test('public listing has explicit safe projection; AI practice never writes exam browser statistics', async () => {
  let statement='';
  await service.listPublishedAI(async sql=>{statement=sql;return [];},'','','');
  assert(statement.includes("status='published' AND review_status='approved'"));
  assert(!statement.includes('SELECT *')); assert(!statement.includes("content->>'answer'"));
  const ui=readFileSync(new URL('../app/ai-questions/AIPractice.tsx',import.meta.url),'utf8');
  for(const forbidden of ['saveProgress(', 'addDailyProgress(', 'saveWrongQuestion(', 'localStorage.', '/api/stats/answers']) assert(!ui.includes(forbidden));
});

test('PostgreSQL: additive migration, preview/import/replay, review isolation, immutable attempts, version conflicts and rollback', {skip:process.env.AI_QUESTIONS_DB_TEST!=='1'}, async()=>{
  nextEnv.loadEnvConfig(process.cwd());
  const client=new pg.Client({connectionString:diagnosticTestConnectionString(),connectionTimeoutMillis:10000});
  await client.connect();
  const schema='ai_questions_test_'+randomUUID().replaceAll('-','');
  const oldSecret=process.env.BETTER_AUTH_SECRET; process.env.BETTER_AUTH_SECRET='ai-test-only';
  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA '+schema);
    await client.query('SET LOCAL search_path TO '+schema); // No fallback to public tables.
    const migration=readFileSync(new URL('../migrations/20261009_ai_question_bank.sql',import.meta.url),'utf8');
    await client.query(migration); await client.query(migration);
    await client.query(readFileSync(new URL('../migrations/20261010_ai_material_generation.sql',import.meta.url),'utf8'));
    await client.query('CREATE TABLE questions(id integer PRIMARY KEY,question text); CREATE TABLE question_answer_stats(question_id integer,is_correct boolean)');
    await client.query("INSERT INTO questions VALUES(1,'exam fixture'); INSERT INTO question_answer_stats VALUES(1,true)");
    const query=async(sql,values)=>(await client.query(sql,values)).rows;
    const batch={name:'test',questions:[q(),{...q(),question:'invalid',answer:'Z'}]};
    const preview=await service.signedAIPreview(query,batch,'admin');
    const body={input:batch,token:preview.token,requestKey:randomUUID()};
    await assert.rejects(service.importAI(client,body,'admin'),/明確/);
    const imported=await service.importAI(client,{...body,onlyValid:true},'admin');
    assert.equal(imported.imported,1); assert.equal(imported.excluded.length,1);
    const replay=await service.importAI(client,{...body,onlyValid:true},'admin');
    assert.equal(replay.replayed,true); assert.equal(replay.batchId,imported.batchId);
    await assert.rejects(service.importAI(client,{...body,onlyValid:true,input:{...batch,name:'changed'}},'admin'),/不同資料/);
    assert.equal((await query('SELECT * FROM ai_questions',[])).length,1);
    const adminRoute=load('app/api/admin/ai-questions/route.ts',{
      '@/lib/admin':{requireAdmin:async()=>({session:{user:{id:'admin'}},sql:{query}})},
      '@/lib/question-transaction':{},'@/lib/ai-question-service':service,'@/lib/ai-question-http':http,'@/lib/ai-question-input':input,
    });
    const listing=await (await adminRoute.GET(new Request('https://vetexam.test/api/admin/ai-questions'))).json();
    assert.equal(listing.batches[0].drafts,1);assert.equal(listing.batches[0].published,0);
    const after=await (await adminRoute.GET(new Request('https://vetexam.test/api/admin/ai-questions?after='+imported.batchId))).json();
    assert.equal(after.batches.length,0);
    const detail=await (await adminRoute.GET(new Request('https://vetexam.test/api/admin/ai-questions?batch='+imported.batchId))).json();
    assert.equal(detail.questions.length,1);
    let row=(await query('SELECT * FROM ai_questions',[]))[0];
    assert.equal(row.kind,'ai'); assert.equal(row.status,'draft'); assert.equal(row.review_status,'pending');
    assert.equal((await service.listPublishedAI(query,'','','')).length,0);
    await assert.rejects(service.answerAI(client,{id:row.id,revision:1,requestKey:randomUUID(),answer:'A'},'member'),/未發布/);
    await assert.rejects(service.updateAI(client,{action:'publish',id:row.id,revision:1},'admin'),/人工核對/);
    row=await service.updateAI(client,{action:'publish',id:row.id,revision:1,confirmReview:true},'admin');
    assert.equal(row.review_status,'approved'); assert.equal(row.reviewed_by,'admin');
    const visible=await service.listPublishedAI(query,'','',''); assert.equal(visible.length,1);
    for(const field of ['answer','content','source','explanation']) assert(!(field in visible[0]));
    const answer={id:row.id,revision:row.revision,requestKey:randomUUID(),answer:'A'};
    const result=await service.answerAI(client,answer,'member'); assert.equal(result.correct,true); assert.deepEqual(result.source,q().source);
    await service.answerAI(client,answer,'member');
    assert.equal((await query('SELECT * FROM ai_question_attempts',[])).length,1);
    await assert.rejects(service.answerAI(client,{...answer,answer:'B'},'member'),/其他作答/);
    const attemptBefore=(await query('SELECT * FROM ai_question_attempts',[]))[0];
    const changed={...row.content,answer:'B',explanation:'修正後解析'};
    row=await service.updateAI(client,{action:'save',id:row.id,revision:row.revision,content:changed},'admin');
    assert.equal(row.status,'draft'); assert.equal(row.reviewed_at,null);
    assert.equal((await service.listPublishedAI(query,'','','')).length,0);
    assert.deepEqual((await query('SELECT * FROM ai_question_attempts',[]))[0],attemptBefore);
    await assert.rejects(service.updateAI(client,{action:'publish',id:row.id,revision:1,confirmReview:true},'admin'),/其他視窗/);
    row=await service.updateAI(client,{action:'publish',id:row.id,revision:row.revision,confirmReview:true},'admin');
    await assert.rejects(service.answerAI(client,answer,'member'),/版本已更新/);
    const newResult=await service.answerAI(client,{...answer,revision:row.revision,requestKey:randomUUID(),answer:'B'},'member');
    assert.equal(newResult.answer,'B'); assert.equal(newResult.explanation,'修正後解析');
    row=await service.updateAI(client,{action:'unpublish',id:row.id,revision:row.revision},'admin');
    assert.equal((await service.listPublishedAI(query,'','','')).length,0);
    assert.deepEqual(await query('SELECT * FROM question_answer_stats',[]),[{question_id:1,is_correct:true}]);
    assert.deepEqual(await query('SELECT * FROM questions',[]),[{id:1,question:'exam fixture'}]);
    // A failed final insert rolls back the batch marker too.
    const second={name:'rollback',questions:[{...q(),question:'second unique question'}]};
    const p2=await service.signedAIPreview(query,second,'admin');
    const key=randomUUID();
    await client.query('SAVEPOINT failure');
    const broken={query:async(sql,values)=>sql.startsWith('INSERT INTO ai_questions(')?client.query('SELECT 1/0'):client.query(sql,values)};
    await assert.rejects(service.importAI(broken,{input:second,token:p2.token,requestKey:key},'admin'));
    await client.query('ROLLBACK TO SAVEPOINT failure');
    assert.equal((await query('SELECT * FROM ai_question_batches WHERE request_key=$1',[key])).length,0);
  } finally {
    await client.query('ROLLBACK'); await client.end();
    if(oldSecret===undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET=oldSecret;
  }
});

test('AI request timeout works without AbortSignal.timeout on the production Safari target', async () => {
  const { fetchAI } = load('lib/ai-question-client.ts');
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  try {
    AbortSignal.timeout = undefined;
    globalThis.fetch = async (_url, init) => { assert(init.signal instanceof AbortSignal); return Response.json({ ok: true }); };
    assert.deepEqual(await (await fetchAI('/fixture')).json(), { ok: true });
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    await assert.rejects(fetchAI('/fixture', {}, 5), /aborted/);
  } finally { globalThis.fetch = originalFetch; AbortSignal.timeout = originalTimeout; }
});
