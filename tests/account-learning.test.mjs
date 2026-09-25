import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
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
const service = load('lib/learning-service.ts', { './question-stats': stats });
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
    await client.setLearningOwner('alice');assert.equal(values.get('learningMigrated:alice'),undefined);assert.equal(values.get('progress'),original);
    fail=false;await client.setLearningOwner('alice');assert.equal(values.get('learningMigrated:alice'),'1');assert.equal(values.get('progress'),original);
    await client.setLearningOwner('alice');assert.equal(imports,2);
    current='bob';await client.setLearningOwner('bob');assert.equal(imports,2);assert.equal(client.getLearning().owner,'bob');
    await client.setLearningOwner(null);assert.equal(client.getLearning(),null);
    client.recordLearning([{question_id:1,selected_answer:'A'}]);assert.equal(values.has('learningOutbox:null'),false);
  } finally { globalThis.fetch=previous;delete globalThis.localStorage; }
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
    assert.equal(a.history.length,3);assert.equal(a.progress.subject.wrong,1);assert.equal(a.wrongQuestions.length,1);assert.deepEqual(b.progress,{});assert.equal(b.history.length,0);
    assert.deepEqual(await service.readLearning(db,'alice'),a,'another device reads identical state');
  } finally { await db.query('ROLLBACK');await db.end(); }
});
