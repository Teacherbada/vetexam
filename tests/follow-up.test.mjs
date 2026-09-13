import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import nextEnv from '@next/env';
import pg from 'pg';
import { diagnosticTestConnectionString } from './diagnostic-database.mjs';
function load(path, mocks = {}) {
  const exports = {};
  new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name => {
    if (name === 'server-only') return {};
    if (Object.hasOwn(mocks,name)) return mocks[name];
    throw new Error('Unexpected import '+name);
  },exports);
  return exports;
}
const chapters=load('data/exam-chapters.ts'), config=load('lib/follow-up-config.ts');
const diagnostic=load('lib/diagnostic.ts',{'../data/exam-chapters':chapters});
const weakness=load('lib/weakness.ts',{'../data/exam-chapters':chapters});
const rules=load('lib/follow-up.ts',{'../data/exam-chapters':chapters,'./follow-up-config':config});
const reinforcementRules=load('lib/reinforcement.ts',{'../data/exam-chapters':chapters});
const service=load('lib/diagnostic-service.ts',{'node:crypto':{randomUUID},'@/data/exam-chapters':chapters,'@/lib/diagnostic':diagnostic,'@/lib/question-answer':load('lib/question-answer.ts'),'@/lib/question-stats':load('lib/question-stats.ts')});
const confirmation=load('lib/confirmation-service.ts',{'@/lib/diagnostic-service':service,'@/lib/weakness':weakness});
const store=load('lib/follow-up-store.ts',{'node:crypto':{randomUUID},'./follow-up-config':config});
const reinforcement=load('lib/reinforcement-service.ts',{'node:crypto':{randomUUID},'@/lib/diagnostic-service':service,'@/lib/confirmation-service':confirmation,'@/lib/reinforcement':reinforcementRules,'@/lib/follow-up-store':store});
const follow=load('lib/follow-up-service.ts',{'@/lib/diagnostic-service':service,'@/lib/follow-up':rules,'@/lib/follow-up-store':store,'@/lib/follow-up-config':config});
const subject=chapters.EXAM_SUBJECTS[0], chapter=chapters.chapterGroups(subject)[0].chapters[0];
test('follow-up selection avoids recent and previous tests, prefers unseen, exact chapters and least-used ties',()=>{
  const now=Date.parse('2026-09-14T00:00:00Z');
  const row=(id,extra={})=>({id,subject,chapter,last_answered:null,last_seen:null,appearances:0,previous:false,...extra});
  const old='2026-08-01T00:00:00Z', recent='2026-09-13T00:00:00Z';
  const pool=[row(1,{last_answered:recent,last_seen:recent,previous:true}),row(2,{last_answered:old,last_seen:old,appearances:4}),row(3),row(4),row(5,{chapter:null}),row(6,{subject:'invalid'})];
  assert.deepEqual(rules.selectFollowUpQuestions(pool,subject,chapter,now,()=>0).map(r=>r.id),[3,4]);
  assert.deepEqual(rules.selectFollowUpQuestions(pool.slice(0,2),subject,chapter,now,()=>0).map(r=>r.id),[2,1]);
  const tied=[row(1,{last_answered:old,last_seen:old,appearances:5}),row(2,{last_answered:old,last_seen:old,appearances:1}),row(3,{last_answered:old,last_seen:old,appearances:2})];
  assert.deepEqual(rules.selectFollowUpQuestions(tied,subject,chapter,now,()=>0).map(r=>r.id),[2,3]);
  assert.equal(rules.selectFollowUpQuestions([row(1),row(1)],subject,chapter).length,1);
  assert.equal(rules.selectFollowUpQuestions(pool,subject,'invalid').length,0);
});
test('follow-up API authenticates, validates origin, payload size, IDs and conceals server errors',async()=>{
  const api=userId=>load('app/api/study-plan/follow-up/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/auth':{auth:{api:{getSession:async()=>userId?{user:{id:userId}}:null}}},
    '@/lib/question-transaction':{questionTransaction:()=>{throw new Error('secret')}},'@/lib/diagnostic-service':service,'@/lib/diagnostic':diagnostic,'@/lib/reinforcement':reinforcementRules,'@/lib/follow-up-service':follow,
  });
  const url='https://test.local/api/study-plan/follow-up';
  for(const method of ['GET','POST','PUT']) assert.equal((await api(null)[method](new Request(url,{method}))).status,401);
  for(const method of ['POST','PUT']) {
    assert.equal((await api('alice')[method](new Request(url,{method,headers:{origin:'https://evil.local'}}))).status,403);
    for(const [body,status] of [['{',400],['x'.repeat(1025),413],[JSON.stringify({followUpId:randomUUID(),userId:'bob'}),400]]) assert.equal((await api('alice')[method](new Request(url,{method,headers:{'Content-Type':'application/json'},body}))).status,status);
  }
  assert.equal((await api('alice').GET(new Request(url+'?id=invalid'))).status,400);
  const response=await api('alice').GET(new Request(url)); assert.equal(response.status,503); assert.doesNotMatch(await response.text(),/secret/);
});
test('PostgreSQL follow-up schedule, overdue stages, stable/queued, idempotence, history, ownership and fallback', {skip:process.env.FOLLOW_UP_DB_TEST!=='1',timeout:240000},async()=>{
  nextEnv.loadEnvConfig(process.cwd());
  const client=new pg.Client({connectionString:diagnosticTestConnectionString(),connectionTimeoutMillis:10000}); await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE study_plans(user_id text PRIMARY KEY,mode text);
      CREATE TEMP TABLE question_sets(id integer PRIMARY KEY,visibility text);
      CREATE TEMP TABLE questions(id integer PRIMARY KEY,question_set_id integer,subject text,chapter text,question text,answer text,option_a text,option_b text,option_c text,option_d text,option_e text,image_data_url text);
      CREATE TEMP TABLE question_answer_stats(id bigserial,user_id text,question_id integer,is_correct boolean,selected_answer text,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,question_id));
      INSERT INTO study_plans VALUES('alice','coach'),('bob','coach'),('custom','custom'); INSERT INTO question_sets VALUES(1,'public'),(2,'private');`);
    const sql=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').replaceAll('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE IF NOT EXISTS');
    for(const name of ['20260914_initial_diagnostic.sql','20260915_diagnostic_confirmation.sql','20260916_reinforcement_tasks.sql','20260917_follow_ups.sql','20260917_follow_ups.sql']) await client.query(sql(name));
    const initial=randomUUID(), taskId=randomUUID();
    await client.query("INSERT INTO diagnostic_sessions(id,user_id,completed_at) VALUES($1,'alice',CURRENT_TIMESTAMP)",[initial]);
    const baseline={subject,chapter,status:'strengthen',accuracy:0,correct:0,count:5};
    await client.query(`INSERT INTO reinforcement_tasks(id,user_id,subject,chapter,source_session_id,source_analysis,status,review_completed_at)
      VALUES($1,'alice',$2,$3,$4,$5,'reviewed',CURRENT_TIMESTAMP)`,[taskId,subject,chapter,initial,JSON.stringify(baseline)]);
    await client.query(`INSERT INTO questions(id,question_set_id,subject,chapter,question,answer,option_a,option_b)
      SELECT i,1,$1,$2,'Fixture','A','A','B' FROM generate_series(1,20) i`,[subject,chapter]);
    const historical=await confirmation.readWeaknessAnalysis(client,'alice');
    let rem=await reinforcement.changeReinforcement(client,'alice',{taskId,action:'verify',reviewAttempt:1});
    for(let position=1;position<=5;position++) rem=await reinforcement.answerReinforcement(client,'alice',taskId,{sessionId:rem.session.id,position,answer:'A'});
    assert.equal(rem.task.status,'short_term');
    let view=await follow.readFollowUp(client,'alice'); const first=view.followUp.id;
    assert.equal(view.followUp.status,'pending'); assert.equal(view.followUp.stage,1);
    assert.equal(Date.parse(view.followUp.due_at)-Date.parse(rem.task.verification_completed_at),config.FOLLOW_UP_INTERVALS_DAYS[0]*86400000);
    assert.equal((await store.dueFollowUps(client,'alice')).length,0);
    await store.scheduleFollowUp(client,taskId); assert.equal((await follow.readFollowUp(client,'alice')).history.length,1);
    await assert.rejects(follow.startFollowUp(client,'alice',first),e=>e.status===409);
    await assert.rejects(follow.startFollowUp(client,'bob',first),e=>e.status===404);
    await assert.rejects(follow.startFollowUp(client,'custom',first),e=>e.status===409);
    // Move only fixture due_at; production scheduling always uses database time.
    await client.query("UPDATE chapter_follow_ups SET due_at=CURRENT_TIMESTAMP-interval '4 days' WHERE id=$1",[first]);
    rem=await reinforcement.readReinforcement(client,'alice'); assert.equal(rem.due[0].id,first);
    view=await follow.startFollowUp(client,'alice',first); assert.equal(view.session.total,2);
    const firstSession=view.session.id;
    assert.equal((await follow.startFollowUp(client,'alice',first)).session.id,firstSession);
    const ids=async id=>(await client.query('SELECT source_question_id,subject,chapter FROM diagnostic_items WHERE session_id=$1',[id])).rows;
    const verificationIds=await ids(rem.session.id), firstIds=await ids(firstSession);
    assert(firstIds.every(r=>r.subject===subject&&r.chapter===chapter&&!verificationIds.some(v=>v.source_question_id===r.source_question_id)));
    assert.doesNotMatch(JSON.stringify(view),/answer_key|selected_answer/);
    await assert.rejects(service.answerDiagnostic(client,'alice',{sessionId:firstSession,position:1,answer:'A'},'verification'),e=>e.status===404);
    await follow.answerFollowUp(client,'alice',first,{sessionId:firstSession,position:1,answer:'A'});
    await client.query('COMMIT'); await client.query('BEGIN');
    assert.equal((await follow.readFollowUp(client,'alice',first)).session.answered,1);
    view=await follow.answerFollowUp(client,'alice',first,{sessionId:firstSession,position:1,answer:'A'}); assert.equal(view.session.answered,1);
    view=await follow.answerFollowUp(client,'alice',first,{sessionId:firstSession,position:2,answer:'A'});
    assert.equal(view.followUp.status,'completed');
    const secondRow=view.history.find(r=>r.stage===2); assert(secondRow);
    assert.equal(Date.parse(secondRow.due_at)-Date.parse(view.followUp.completed_at),config.FOLLOW_UP_INTERVALS_DAYS[1]*86400000);
    assert.equal((await reinforcement.readReinforcement(client,'alice')).task.status,'short_term');
    await follow.answerFollowUp(client,'alice',first,{sessionId:firstSession,position:2,answer:'A'}); assert.equal((await follow.readFollowUp(client,'alice')).history.length,2);
    await assert.rejects(follow.startFollowUp(client,'alice',secondRow.id),e=>e.status===409);
    await client.query('UPDATE chapter_follow_ups SET due_at=CURRENT_TIMESTAMP WHERE id=$1',[secondRow.id]);
    view=await follow.startFollowUp(client,'alice',secondRow.id);
    assert((await ids(view.session.id)).every(r=>!firstIds.some(old=>old.source_question_id===r.source_question_id)));
    for(let position=1;position<=2;position++) view=await follow.answerFollowUp(client,'alice',secondRow.id,{sessionId:view.session.id,position,answer:'A'});
    rem=await reinforcement.readReinforcement(client,'alice'); assert.equal(rem.task.status,'stable'); assert.equal(rem.completed[0].status,'stable');
    assert.deepEqual(await confirmation.readWeaknessAnalysis(client,'alice'),historical);
    assert.equal((await service.diagnosticCandidates(client,'alice')).length,20,'stable chapters remain in ordinary candidate pool');
    // New cycle fixture: failing a due follow-up while another reinforcement is active must queue, not violate uniqueness.
    await client.query("UPDATE reinforcement_tasks SET status='short_term',review_count=2 WHERE id=$1",[taskId]);
    await store.scheduleFollowUp(client,taskId); view=await follow.readFollowUp(client,'alice'); const failedId=view.followUp.id;
    await client.query('UPDATE chapter_follow_ups SET due_at=CURRENT_TIMESTAMP WHERE id=$1',[failedId]);
    view=await follow.startFollowUp(client,'alice',failedId);
    const another=randomUUID();
    await client.query(`INSERT INTO reinforcement_tasks(id,user_id,subject,chapter,source_session_id,source_analysis,status)
      VALUES($1,'alice',$2,'another fixture chapter',$3,$4,'reviewing')`,[another,subject,initial,JSON.stringify(baseline)]);
    for(let position=1;position<=2;position++) view=await follow.answerFollowUp(client,'alice',failedId,{sessionId:view.session.id,position,answer:'B'});
    assert.equal(view.followUp.status,'failed'); assert.equal(view.followUp.result.correct,0);
    assert.equal((await client.query('SELECT status FROM reinforcement_tasks WHERE id=$1',[taskId])).rows[0].status,'queued');
    assert.equal((await reinforcement.startReinforcement(client,'alice')).task.id,another);
    await client.query("UPDATE reinforcement_tasks SET status='stable' WHERE id=$1",[another]);
    rem=await reinforcement.startReinforcement(client,'alice'); assert.equal(rem.task.id,taskId); assert.equal(rem.task.review_count,3); assert.equal(rem.task.status,'reviewing');
    assert.equal((await reinforcement.startReinforcement(client,'alice')).task.id,taskId);
    assert.equal((await follow.readFollowUp(client,'alice',failedId)).followUp.status,'failed');
    assert.equal((await follow.readFollowUp(client,'alice',first)).followUp.result.correct,2);
    // Exhausted public pool: zero retains due; one reused question completes conservatively as insufficient.
    await client.query("UPDATE reinforcement_tasks SET status='short_term',verification_completed_at=CURRENT_TIMESTAMP,review_completed_at=CURRENT_TIMESTAMP WHERE id=$1",[taskId]);
    await store.scheduleFollowUp(client,taskId); view=await follow.readFollowUp(client,'alice'); const small=view.followUp.id;
    await client.query('UPDATE chapter_follow_ups SET due_at=CURRENT_TIMESTAMP WHERE id=$1',[small]);
    await client.query('UPDATE questions SET question_set_id=2');
    await assert.rejects(follow.startFollowUp(client,'alice',small),e=>e.status===409);
    assert.equal((await follow.readFollowUp(client,'alice',small)).session,null);
    await client.query('UPDATE questions SET question_set_id=1 WHERE id=$1',[firstIds[0].source_question_id]);
    view=await follow.startFollowUp(client,'alice',small); assert.equal(view.session.total,1);
    view=await follow.answerFollowUp(client,'alice',small,{sessionId:view.session.id,position:1,answer:'A'});
    assert.equal(view.followUp.result.reused,1); assert.equal(view.followUp.result.sufficient,false); assert.equal(view.followUp.status,'failed');
  } finally { await client.query('ROLLBACK').catch(()=>{}); await client.end(); }
});
