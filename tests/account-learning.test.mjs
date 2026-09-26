import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { memoryService } from './memory-test-loader.mjs';
function load(path, mocks = {}) {
  const exports = {};
  new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => {
    if (name === 'server-only') return {};
    if (name in mocks) return mocks[name];
    throw new Error(name);
  }, exports);
  return exports;
}
const stats = load('lib/question-stats.ts');
const service = load('lib/learning-service.ts', { './question-stats': stats, './question-state': load('lib/question-state.ts'), './question-memory-service': memoryService });
test('API rejects guests, cross-account queues, cross-origin writes and invalid answers', async () => {
  let owner = null, writes = 0;
  const api = load('app/api/learning/route.ts', {
    '@/lib/auth': { auth: { api: { getSession: async () => owner ? { user: { id: owner } } : null } } },
    '@/lib/question-stats': stats,
    '@/lib/learning-service': { ...service, recordPractice: async () => { writes++; } },
    '@/lib/question-transaction': { questionTransaction: async fn => fn({}) },
  });
  const req = (body, origin = 'https://test.local') => new Request('https://test.local/api/learning', { method: 'POST', headers: { origin, 'content-type':'application/json' }, body: JSON.stringify(body) });
  const valid = { action:'answers', owner:'alice', mode:'practice', answers:[{ question_id:1, selected_answer:'A', event_id:randomUUID() }] };
  assert.equal((await api.POST(req(valid))).status,401); assert.equal(writes,0);
  owner='alice';
  assert.equal((await api.POST(req(valid,'https://evil.local'))).status,403);
  assert.equal((await api.POST(req({...valid,owner:'bob'}))).status,409);
  assert.equal((await api.POST(req({...valid,answers:[{...valid.answers[0],selected_answer:'F'}]}))).status,400);
  assert.equal((await api.POST(req(valid))).status,200); assert.equal(writes,1);
});
test('migration retries preserve originals and only mark success; archives stay with first owner', async () => {
  const values = new Map([['progress','{"old":{"answered":[1],"correct":1,"wrong":0}}']]);
  globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const previous = globalThis.fetch;
  let fail=true, imports=0, current='alice';
  globalThis.fetch=async (_url,options) => {
    if(options?.method==='POST') { const body=JSON.parse(options.body); if(body.action==='import')imports++; return Response.json({}, {status:fail?503:200}); }
    return Response.json({owner:current,progress:{},favorites:[],wrongQuestions:[],history:[],legacy:[]});
  };
  const client=load('lib/learning-client.ts');
  try {
    const original=values.get('progress');
    await client.setLearningOwner('alice');assert.equal(values.get('learningMigrated:alice'),undefined);assert.equal(values.get('progress'),original);assert.equal(client.getLearningStatus(),'error');
    fail=false;await client.retryLearning();assert.equal(values.get('learningMigrated:alice'),'1');assert.equal(values.get('progress'),original);assert.equal(client.getLearningStatus(),'ready');
    await client.setLearningOwner('alice');assert.equal(imports,2);
    current='bob';await client.setLearningOwner('bob');assert.equal(imports,2);assert.equal(client.getLearning().owner,'bob');
    await client.setLearningOwner(null);assert.equal(client.getLearning(),null);
    client.recordLearning([{question_id:1,selected_answer:'A'}]);assert.equal(values.has('learningOutbox:null'),false);
  } finally { globalThis.fetch=previous;delete globalThis.localStorage; }
});
test('interrupted answer queues retry the same event, preserve later attempts and isolate accounts', async () => {
  const values=new Map(),previous=globalThis.fetch;
  globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  let fail=true,owner='alice';const sent=[];
  globalThis.fetch=async(_url,options)=>{
    if(options?.method==='POST') {
      const body=JSON.parse(options.body);
      if(body.action==='answers'){sent.push(body);return Response.json({}, {status:fail?503:200});}
      return Response.json({success:true});
    }
    return Response.json({owner,progress:{},favorites:[],wrongQuestions:[],history:[],legacy:[]});
  };
  const client=load('lib/learning-client.ts');
  try {
    await client.setLearningOwner(owner);
    client.recordLearning([{question_id:1,selected_answer:'B'}]);await client.flushLearning();
    const queued=JSON.parse(values.get('learningOutbox:alice'));assert.equal(queued.length,1);
    const event=queued[0].answers[0].event_id;
    owner='bob';await client.setLearningOwner(owner);assert.equal(JSON.parse(values.get('learningOutbox:alice')).length,1);
    fail=false;owner='alice';await client.setLearningOwner(owner);assert.equal(JSON.parse(values.get('learningOutbox:alice')).length,0);
    assert.equal(sent.at(-1).answers[0].event_id,event);
    client.recordLearning([{question_id:1,selected_answer:'A'}]);await client.flushLearning();
    assert.notEqual(sent.at(-1).answers[0].event_id,event);assert.ok(sent.every(body=>body.owner==='alice'));
    await client.setLearningOwner(null);const before=sent.length;client.recordLearning([{question_id:1,selected_answer:'A'}]);await client.flushLearning();assert.equal(sent.length,before);
  } finally {globalThis.fetch=previous;delete globalThis.localStorage;}
});
test('PostgreSQL: additive migration, retries, repeated attempts, shared first answer and scoped history', { skip: process.env.LEARNING_DB_TEST !== '1' }, async () => {
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL||process.env.DATABASE_URL,connectionTimeoutMillis:10000});await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`CREATE TEMP TABLE "user"(id text PRIMARY KEY); INSERT INTO "user" VALUES('alice'),('bob');
      CREATE TEMP TABLE question_sets(id integer PRIMARY KEY, visibility text);
      INSERT INTO question_sets VALUES(1,'public'),(2,'private');
      CREATE TEMP TABLE questions(id integer PRIMARY KEY,question_set_id integer,subject text,chapter text,question text,answer text,explanation text,option_a text,option_b text,option_c text,option_d text,option_e text);
      INSERT INTO questions VALUES(1,1,'subject','chapter','q','A','','a','b','c','d',NULL),(2,2,'subject','chapter','private','A','','a','b','c','d',NULL);
      CREATE TEMP TABLE diagnostic_sessions(id uuid PRIMARY KEY,user_id text,kind text);
      CREATE TEMP TABLE diagnostic_items(session_id uuid,source_question_id integer,subject text,chapter text,selected_answer text,is_correct boolean,answered_at timestamptz);`);
    const first=readFileSync(new URL('../migrations/20260912_question_answer_stats.sql',import.meta.url),'utf8').replaceAll('CREATE TABLE','CREATE TEMP TABLE');
    await db.query(first);await db.query('ALTER TABLE question_answer_stats ADD selected_answer text');
    const migration=readFileSync(new URL('../migrations/20260925_account_learning.sql',import.meta.url),'utf8').replaceAll('CREATE TABLE','CREATE TEMP TABLE');
    await db.query(migration);await db.query(migration);
    await db.query(readFileSync(new URL('../migrations/20260925_question_memory_state.sql',import.meta.url),'utf8').replaceAll('CREATE TABLE','CREATE TEMP TABLE'));
    const event={question_id:1,selected_answer:'B',event_id:randomUUID()};
    await service.recordPractice(db,'alice',[event],'practice');await service.recordPractice(db,'alice',[event],'practice');
    await service.recordPractice(db,'alice',[{...event,event_id:randomUUID(),selected_answer:'A'}],'exam');
    await service.recordPractice(db,'alice',[{...event,question_id:2,event_id:randomUUID()}],'practice');
    assert.equal((await db.query('SELECT * FROM practice_attempts')).rows.length,2);
    assert.equal((await db.query('SELECT * FROM question_answer_stats')).rows.length,1);
    const session=randomUUID();await db.query("INSERT INTO diagnostic_sessions VALUES($1,'alice','custom')",[session]);
    await db.query("INSERT INTO diagnostic_items VALUES($1,1,'subject','chapter','A',TRUE,now())",[session]);
    await stats.recordFirstAnswers(async(t,v)=>(await db.query(t,v)).rows,'alice',[{question_id:1,selected_answer:'A'}]);
    const a=await service.readLearning(db,'alice'), b=await service.readLearning(db,'bob');
    assert.equal(a.history.length,3);assert.equal(a.progress.subject.wrong,1);assert.equal(a.wrongQuestions.length,1);assert.deepEqual(Object.keys(b.progress),[]);assert.equal(b.history.length,0);
    assert.deepEqual(await service.readLearning(db,'alice'),a,'another device reads identical state');
    assert.equal(a.wrongQuestions[0].userAnswer,'B');
    await db.query("INSERT INTO question_review_state(user_id,question_id,wrong,wrong_updated_at) VALUES('alice',1,FALSE,clock_timestamp())");
    assert.equal((await service.readLearning(db,'alice')).wrongQuestions.length,0);
    assert.deepEqual((await service.readQuestionState(db,'alice')).wrong,[1],'ever-wrong filter includes dismissed items');
    const afterDismissal=(await db.query("SELECT clock_timestamp() + interval '1 second' AS instant")).rows[0].instant.toISOString();
    await service.recordPractice(db,'alice',[{...event,event_id:randomUUID(),answered_at:afterDismissal}],'practice');
    assert.equal((await service.readLearning(db,'alice')).wrongQuestions.length,1,'a later mistake reopens the review item');
    const api=load('app/api/learning/route.ts',{
      '@/lib/auth':{auth:{api:{getSession:async()=>({user:{id:'alice'}})}}},
      '@/lib/question-stats':stats,'@/lib/learning-service':service,
      '@/lib/question-transaction':{questionTransaction:async fn=>fn(db)},
    });
    const deviceId=randomUUID(),payload={progress:{s:{answered:[1,3],correct:1,wrong:1}},favorites:[{id:1},{id:1}],wrongQuestions:[{id:1,note:'legacy note'}]};
    await db.query('DELETE FROM question_review_state');
    const request=()=>new Request('https://test.local/api/learning',{method:'POST',headers:{'content-type':'application/json',origin:'https://test.local'},body:JSON.stringify({owner:'alice',action:'import',deviceId,payload})});
    assert.equal((await api.POST(request())).status,200);assert.equal((await api.POST(request())).status,200);
    assert.equal((await db.query('SELECT * FROM learning_imports')).rows.length,1);
    const imported=(await db.query('SELECT * FROM question_review_state')).rows[0];
    assert.equal(imported.favorite,true);assert.equal(imported.wrong,true);assert.equal(imported.note,'legacy note');
    await db.query("UPDATE question_review_state SET favorite=FALSE,wrong=NULL,note='' WHERE user_id='alice'");
    const secondImport=new Request('https://test.local/api/learning',{method:'POST',headers:{'content-type':'application/json',origin:'https://test.local'},body:JSON.stringify({owner:'alice',action:'import',deviceId:randomUUID(),payload})});
    assert.equal((await api.POST(secondImport)).status,200);
    const merged=(await db.query('SELECT * FROM question_review_state')).rows[0];
    assert.equal(merged.favorite,false,'an explicit account removal wins over another browser archive');
    assert.equal(merged.wrong,true,'unknown fields merge independently');assert.equal(merged.note,'','an explicitly cleared account note is preserved');
    await db.query("UPDATE question_review_state SET favorite=TRUE WHERE user_id='alice'");
    assert.equal((await db.query('SELECT * FROM question_answer_stats')).rows.length,1,'imports never fabricate first answers');
    assert.deepEqual((await service.readQuestionState(db,'alice')).answered.sort(),[1,3]);
    await db.query("ALTER TABLE questions ADD question_number integer DEFAULT 1; ALTER TABLE question_sets ADD exam_year integer DEFAULT 115; ALTER TABLE question_sets ADD name text DEFAULT 'fixture'");
    function sql(strings,...values) {
      const fragment={strings,values};
      fragment.then=(resolve,reject)=>{
        const parameters=[];
        const render=part=>part.strings.reduce((text,item,index)=>{
          if(!index)return item;const value=part.values[index-1];
          if(value?.strings)return text+render(value)+item;
          parameters.push(value);return text+'$'+parameters.length+item;
        },'');
        return db.query(render(fragment),parameters).then(result=>result.rows).then(resolve,reject);
      };return fragment;
    }
    let quizOwner='alice';
    const quiz=load('app/api/quiz/route.ts',{
      'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@neondatabase/serverless':{neon:()=>sql},
      '@/lib/auth':{auth:{api:{getSession:async()=>quizOwner?{user:{id:quizOwner}}:null}}},
      '@/data/exam-chapters':load('data/exam-chapters.ts'),'@/lib/question-state':load('lib/question-state.ts'),
      '@/lib/question-transaction':{questionTransaction:async fn=>fn(db)},'@/lib/learning-service':service,
      '@/lib/home-public-data': {},
    });
    const quizRequest=state=>new Request('https://test.local/api/quiz?'+new URLSearchParams({scope:'public',groups:JSON.stringify([{subject:'subject',years:[],count:'all'}]),state}));
    for(const [state,total] of [['all',1],['unanswered',0],['wrong',1],['favorites',1]]){
      const result=await quiz.GET(quizRequest(state));assert.equal(result.status,200);assert.equal((await result.json()).questions.length,total);
    }
    quizOwner=null;assert.equal((await quiz.GET(quizRequest('wrong'))).status,401);
    assert.equal((await quiz.GET(quizRequest('all'))).status,200);
  } finally { await db.query('ROLLBACK');await db.end(); }
});
