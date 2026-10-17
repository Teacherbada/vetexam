import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import ts from 'typescript';
import pg from 'pg';
import nextEnv from '@next/env';
import {diagnosticTestConnectionString} from './diagnostic-database.mjs';
const require=createRequire(import.meta.url);
function load(path,mocks={}){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(name==='server-only')return {};if(name in mocks)return mocks[name];if(name==='./question-answer'||name==='@/lib/question-answer')return load('lib/question-answer.ts');if(name.startsWith('node:'))return require(name);throw Error('Unexpected '+name);},exports);return exports;}
const taxonomy=load('data/exam-chapters.ts'),input=load('lib/ai-question-input.ts',{'@/data/exam-chapters':taxonomy});
const signing=load('lib/admin-questions.ts',{'./admin-question-input':load('lib/admin-question-input.ts')});
const ai=load('lib/ai-question-service.ts',{'./ai-question-input':input,'./admin-questions':signing});
const stats=load('lib/question-stats.ts');
const q=JSON.parse(readFileSync(new URL('../public/examples/ai-questions.json',import.meta.url))).questions[0];
test('exam submission parser rejects AI UUIDs and forged question kinds',()=>{
 assert.equal(stats.parseAnswerSubmissions({answers:[{question_id:randomUUID(),selected_answer:'A'}]}),null);
 assert.equal(stats.parseAnswerSubmissions({answers:[{question_id:1,selected_answer:'A',kind:'ai'}]}),null);
 assert.equal(stats.parseAnswerSubmissions({answers:[{question_id:1,selected_answer:'A'}],kind:'ai'}),null);
});
test('all exam/coach/leaderboard selectors retain their physical exam-table boundary',()=>{
 for(const file of ['app/api/quiz/route.ts','app/api/questions/route.ts','lib/home-public-data.ts','lib/diagnostic-service.ts','lib/confirmation-service.ts','lib/reinforcement-service.ts','lib/follow-up-service.ts','lib/daily-task-service.ts','lib/custom-plan-service.ts','lib/question-stats.ts','lib/learning-service.ts','lib/due-review-service.ts']){
  const code=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert(!/ai_questions|ai_question_attempts|ai-material/.test(code),file);
 }
 const material=readFileSync(new URL('../lib/ai-material-service.ts',import.meta.url),'utf8');assert(material.includes('INSERT INTO ai_questions'));assert(!/INSERT INTO questions\b/.test(material));
});
test('PostgreSQL: mixed banks, actual random/subject/year/mock-exam routes, coach candidates, member drafts and isolated statistics',{skip:process.env.AI_QUESTIONS_DB_TEST!=='1'},async()=>{
 nextEnv.loadEnvConfig(process.cwd());const c=new pg.Client({connectionString:diagnosticTestConnectionString(),connectionTimeoutMillis:10000});await c.connect();
 try{
  await c.query('BEGIN');const schema='ai_isolation_'+randomUUID().replaceAll('-','');await c.query('CREATE SCHEMA '+schema);await c.query('SET LOCAL search_path TO '+schema);
  await c.query(`CREATE TABLE question_sets(id integer PRIMARY KEY,exam_year integer,name text,visibility text,owner_id text,created_at timestamptz DEFAULT now());
   CREATE TABLE questions(id integer PRIMARY KEY,question_set_id integer REFERENCES question_sets(id),question_number integer,subject text,chapter text,question text,option_a text,option_b text,option_c text,option_d text,option_e text,answer text,explanation text,image_data_url text);
   CREATE TABLE question_answer_stats(id serial PRIMARY KEY,user_id text,question_id integer REFERENCES questions(id),is_correct boolean,selected_answer text,created_at timestamptz DEFAULT now(),UNIQUE(user_id,question_id));
   CREATE TABLE practice_attempts(id integer PRIMARY KEY,question_id integer REFERENCES questions(id));
   CREATE TABLE diagnostic_sessions(id uuid PRIMARY KEY,user_id text);
   CREATE TABLE diagnostic_items(session_id uuid,source_question_id integer,answered_at timestamptz);`);
  await c.query("INSERT INTO question_sets VALUES(1,115,'official','public',NULL,now()); INSERT INTO questions VALUES(1,1,1,'獸醫公共衛生學','獸醫流行病學','國考題', 'A','B','C','D','', 'A','original explanation',NULL); INSERT INTO question_answer_stats(user_id,question_id,is_correct,selected_answer) VALUES('old-member',1,true,'A'); INSERT INTO practice_attempts VALUES(1,1)");
  for(const name of ['20261009_ai_question_bank.sql','20261010_ai_material_generation.sql','20261011_ai_practice_isolation.sql','20261011_ai_practice_isolation.sql'])await c.query(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  assert.equal((await c.query('SELECT kind FROM questions')).rows[0].kind,'exam');assert.equal((await c.query('SELECT kind FROM question_answer_stats')).rows[0].kind,'exam');assert.equal((await c.query('SELECT kind FROM practice_attempts')).rows[0].kind,'exam');
  const batch=randomUUID(),published=randomUUID(),draft=randomUUID();
  await c.query('INSERT INTO ai_question_batches(id,request_key,request_hash,name,created_by) VALUES($1,$2,\'hash\',\'fixture\',\'admin\')',[batch,randomUUID()]);
  for(const [id,pos] of [[published,1],[draft,2]])await c.query('INSERT INTO ai_questions(id,batch_id,position,content,fingerprint) VALUES($1,$2,$3,$4::jsonb,$5)',[id,batch,pos,JSON.stringify(q),id]);
  let row=await ai.updateAI(c,{action:'publish',id:published,revision:1,confirmReview:true},'admin');
  const execute=async(text,values)=>(await c.query(text,values)).rows;
  const before=await execute('SELECT * FROM question_answer_stats ORDER BY id',[]),practice=await execute('SELECT * FROM practice_attempts',[]);
  for(const [table,value] of [['questions','ai'],['question_answer_stats','ai'],['practice_attempts','ai'],['ai_questions','exam']]){
   await c.query('SAVEPOINT invalid_kind');await assert.rejects(c.query('UPDATE '+table+' SET kind=$1',[value]));await c.query('ROLLBACK TO SAVEPOINT invalid_kind');
  }
  const response=await ai.answerAI(c,{id:published,revision:row.revision,requestKey:randomUUID(),answer:'A'},'member');assert.equal(response.kind,'ai');assert.equal((await execute('SELECT kind FROM ai_question_attempts',[]))[0].kind,'ai');
  assert.deepEqual(await execute('SELECT * FROM question_answer_stats ORDER BY id',[]),before);assert.deepEqual(await execute('SELECT * FROM practice_attempts',[]),practice);
  const listed=await ai.listPublishedAI(execute,q.subject,q.chapter,'');assert.deepEqual(listed.map(r=>r.id),[published]);assert(listed.every(r=>r.kind==='ai'));assert(!('answer' in listed[0]));
  assert.deepEqual(await ai.listPublishedAI(execute,'獸醫病理學','',''),[]);await assert.rejects(ai.answerAI(c,{id:draft,revision:1,requestKey:randomUUID(),answer:'A'},'member'),/未發布/);
  function sql(strings,...values){const fragment={strings,values};fragment.then=(resolve,reject)=>{const params=[];function render(p){return p.strings.reduce((text,part,index)=>{if(!index)return part;const v=p.values[index-1];if(v?.strings)return text+render(v)+part;params.push(v);return text+'$'+params.length+part;},'');}return execute(render(fragment),params).then(resolve,reject);};return fragment;}
  const route=load('app/api/quiz/route.ts',{'next/server':{NextResponse:{json:(b,i)=>Response.json(b,i)}},'@neondatabase/serverless':{neon:()=>sql},'@/lib/auth':{auth:{api:{getSession:async()=>({user:{id:'member'}})}}},'@/data/exam-chapters':taxonomy,'@/lib/question-state':load('lib/question-state.ts'),'@/lib/question-transaction':{},'@/lib/learning-service':{},'@/lib/home-public-data':{}});
  const groups=JSON.stringify([{subject:q.subject,chapter:q.chapter,years:[115],count:'all'}]);
  for(const filters of [{scope:'public',groups,order:'random'},{scope:'public',groups,mode:'exam'},{scope:'public',groups,order:'ordered'},{subjects:q.subject,years:'115',count:'10',order:'random'},{subjects:q.subject,years:'115',count:'10'}]){
   const response=await route.GET(new Request('https://test.local/api/quiz?'+new URLSearchParams(filters)));assert.equal(response.status,200);assert.deepEqual((await response.json()).questions.map(q=>q.id),[1]);
  }
  const coach=load('lib/diagnostic-service.ts',{'@/data/exam-chapters':taxonomy,'@/lib/question-answer':{},'@/lib/question-stats':stats,'@/lib/diagnostic':{}});
  assert.deepEqual((await coach.diagnosticCandidates(c,'member')).map(r=>r.id),[1]);
  const aiRoute=load('app/api/ai-questions/route.ts',{'@neondatabase/serverless':{neon:()=>({query:execute})},'@/lib/auth':{auth:{api:{getSession:async()=>({user:{id:'member'}})}}},'@/lib/question-transaction':{questionTransaction:run=>run(c)},'@/lib/ai-question-service':ai,'@/lib/ai-question-http':{aiJson:(body,status=200)=>Response.json(body,{status}),aiError:e=>Response.json({error:e.message},{status:e.status||500}),readAIBody:r=>r.json()},'@/data/exam-chapters':taxonomy,'@/lib/ai-question-input':input});
  const publicResponse=await aiRoute.GET(new Request('https://test.local/api/ai-questions?subject='+encodeURIComponent(q.subject)));assert.deepEqual((await publicResponse.json()).questions.map(r=>r.id),[published]);
  assert.equal((await aiRoute.POST(new Request('https://test.local/api/ai-questions',{method:'POST',body:JSON.stringify({id:draft,revision:1,requestKey:randomUUID(),answer:'A'})}))).status,404);
  row=await ai.updateAI(c,{action:'save',id:published,revision:row.revision,content:{...q,question:q.question+' edited'}},'admin');assert.equal(row.status,'draft');assert.deepEqual(await ai.listPublishedAI(execute,'','',''),[]);assert.equal((await c.query('SELECT count(*)::int AS n FROM ai_question_attempts')).rows[0].n,1);
 }finally{await c.query('ROLLBACK');await c.end();}
});
