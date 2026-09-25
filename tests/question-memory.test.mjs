import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createEmptyCard, fsrs, Rating } from 'ts-fsrs';
import { diagnosticTestConnectionString } from './diagnostic-database.mjs';
import { loadMemoryModule as load, memoryService as memory } from './memory-test-loader.mjs';

const stats = load('lib/question-stats.ts');
const learning = load('lib/learning-service.ts', { './question-memory-service':memory, './question-stats':stats, './question-state':load('lib/question-state.ts') });
const chapters = load('data/exam-chapters.ts');
const ruleMocks = { '../data/exam-chapters':chapters, './daily-task-config':load('lib/daily-task-config.ts',{'../data/tasks':load('data/tasks.ts')}), './follow-up-config':load('lib/follow-up-config.ts') };
const daily = load('lib/daily-task.ts',ruleMocks);
const now = new Date('2026-09-25T00:00:00Z'), old = '2026-09-01T00:00:00Z';
const candidate = (id, extra = {}) => ({ id,subject:chapters.EXAM_SUBJECTS[0],chapter:null,last_answered:null,last_seen:null,appearances:0,...extra });
const signal = (due = old, last_review = old) => ({due,last_review});

test('first Again/Good and later reviews match the official deterministic scheduler', () => {
  for (const correct of [false,true]) {
    const first = memory.reviewMemory(undefined,correct,now);
    assert.deepEqual(first,fsrs({enable_fuzz:false}).next(createEmptyCard(now),now,correct ? Rating.Good : Rating.Again).card);
    assert.equal(first.reps,1); assert(first.due > now);
    const later = memory.reviewMemory(first,true,new Date('2026-10-01T00:00:00Z'));
    assert.equal(later.reps,2); assert(later.due > first.due);
    assert.deepEqual(memory.reviewMemory(undefined,correct,now),first);
    const delayed = memory.reviewMemory(later,false,now);
    assert.equal(delayed.reps,3); assert.equal(+delayed.last_review,+later.last_review);
  }
});

test('normal due priority, unseen then old, with recent repetitions last', () => {
  const pool = [candidate(1),candidate(2,{last_answered:old,last_seen:old}),candidate(3,{last_answered:old,last_seen:old})];
  const signals = new Map([[2,signal()],[3,signal('2026-10-01T00:00:00Z')]]);
  assert.deepEqual(daily.selectDailyQuestions(pool,3,[],[],+now,()=>0,signals).map(r=>r.id),[2,1,3]);
  signals.set(2,signal(old,'2026-09-24T00:00:00Z'));
  assert.deepEqual(daily.selectDailyQuestions(pool,3,[],[],+now,()=>0,signals).map(r=>r.id),[1,3,2]);
  signals.set(2,signal(now.toISOString()));
  assert.equal(daily.selectDailyQuestions(pool,1,[],[],+now,()=>0,signals)[0].id,2,'exact due boundary is due');
});

test('due cannot bypass chapter cap, reserved follow-ups, subject balance or weakness quota', () => {
  const subject = chapters.EXAM_SUBJECTS[0], chapter = chapters.chapterGroups(subject)[0].chapters[0];
  const pool = chapters.EXAM_SUBJECTS.flatMap((subject,s)=>Array.from({length:30},(_,n)=>candidate(s*100+n+1,{subject,chapter:chapters.chapterGroups(subject)[0].chapters[0],last_answered:old,last_seen:old})));
  const signals = new Map(pool.filter(r=>r.subject===subject).map(r=>[r.id,signal()]));
  const reserved = pool.slice(0,2);
  const result = daily.selectDailyQuestions(pool,30,reserved,[{subject,chapter}],+now,()=>0,signals);
  assert.equal(result.length,28); assert.equal(result.filter(r=>r.source==='weakness').length,8);
  assert(result.every(r=>!reserved.some(p=>p.id===r.id)));
  assert(result.filter(r=>r.chapter===chapter && r.subject===subject).length+reserved.length<=12);
  const normal = daily.selectDailyQuestions(pool,30,[],[],+now,()=>0,signals);
  for (const subject of chapters.EXAM_SUBJECTS) assert.equal(normal.filter(r=>r.subject===subject).length,5);
  const capped = daily.selectDailyQuestions(pool.slice(0,30),30,reserved,[],+now,()=>0,signals);
  assert.equal(capped.length+reserved.length,12);
  const noMemory = daily.selectDailyQuestions(pool,30,reserved,[{subject,chapter}],+now,()=>0);
  assert.deepEqual(result.filter(r=>r.source==='weakness'),noMemory.filter(r=>r.source==='weakness'));
});

test('empty memory is byte-for-byte equivalent to the base main selection algorithm', () => {
  // SHA256 of all 20 seeded outputs from main 13a1399, before FSRS integration.
  // Includes complete objects, order, quotas and tie values; needs no Git history in CI.
  const results=[];
    for (let seed=1;seed<=20;seed++) {
      const random = () => { let state=seed; return ()=>((state=(state*1664525+1013904223)>>>0)/4294967296); };
      const pool = chapters.EXAM_SUBJECTS.flatMap((subject,s)=>Array.from({length:25},(_,n)=>candidate(s*100+n,{subject,chapter:chapters.chapterGroups(subject)[0].chapters[n%2],last_answered:n%3?old:null,last_seen:n%4?old:now.toISOString(),appearances:n%5})));
      const reserved=pool.slice(0,2), weaknesses=[pool[3]];
      results.push(daily.selectDailyQuestions(pool,30,reserved,weaknesses,+now,random(),new Map()));
    }
  assert.equal(createHash('sha256').update(JSON.stringify(results)).digest('hex'),'d383b07c82aaf7b25ca780013237443f8af1d1a849dee61aa7f56a8e384cd084');
});

test('PostgreSQL memory: persistence, retries, isolation, invalid inputs and atomic rollback', {skip:process.env.MEMORY_DB_TEST!=='1',timeout:120000}, async () => {
  const db = new pg.Client({connectionString:diagnosticTestConnectionString(),connectionTimeoutMillis:10000});
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`CREATE TEMP TABLE "user"(id text PRIMARY KEY); INSERT INTO "user" VALUES('alice'),('bob');
      CREATE TEMP TABLE question_sets(id integer PRIMARY KEY,visibility text); INSERT INTO question_sets VALUES(1,'public'),(2,'private');
      CREATE TEMP TABLE questions(id integer PRIMARY KEY,question_set_id integer,answer text,option_a text,option_b text,option_c text,option_d text,option_e text);
      INSERT INTO questions VALUES(1,1,'A','a','b','c','d',NULL),(2,2,'A','a','b','c','d',NULL),(3,1,'A','a','b','c','d',NULL);
      CREATE TEMP TABLE question_answer_stats(id bigserial,user_id text,question_id integer,is_correct boolean,selected_answer text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,question_id));`);
    for (const name of ['20260925_account_learning.sql','20260925_question_memory_state.sql','20260925_question_memory_state.sql']) await db.query(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').replaceAll('CREATE TABLE','CREATE TEMP TABLE'));
    assert.equal((await db.query('SELECT * FROM question_memory_state')).rowCount,0);
    const answer = (id=1,selected_answer='B',answered_at=now.toISOString()) => ({question_id:id,selected_answer,answered_at,event_id:randomUUID()});
    const first = answer();
    await learning.recordPractice(db,'alice',[first],'practice');
    const get = async (owner='alice',id=1) => (await db.query('SELECT * FROM question_memory_state WHERE user_id=$1 AND question_id=$2',[owner,id])).rows[0];
    const stored=await get(), expected=memory.reviewMemory(undefined,false,now);
    for (const key of Object.keys(expected)) assert.deepEqual(stored[key],expected[key],key+' roundtrips');
    await learning.recordPractice(db,'alice',[first,first],'practice');
    assert.deepEqual(await get(),stored,'duplicate delivery does not even touch updated_at');
    await learning.recordPractice(db,'bob',[{...first,selected_answer:'A'}],'exam');
    const bob=await get('bob'); assert.equal(bob.reps,1); assert.notEqual(bob.stability,stored.stability);
    const later=answer(1,'A','2026-10-01T00:00:00Z');
    await learning.recordPractice(db,'alice',[later],'exam');
    assert.equal((await get()).reps,2); assert.deepEqual(await get('bob'),bob);
    await learning.recordPractice(db,'alice',[answer(2),answer(999)],'practice');
    assert.equal((await db.query('SELECT * FROM question_memory_state')).rowCount,2,'private and absent IDs excluded');
    await db.query('COMMIT'); await db.query('BEGIN');
    assert.equal((await get()).reps,2,'card survives transaction boundary');
    const queries=[];
    const traced={query:async(text,values)=>{queries.push(text);return db.query(text,values);}};
    const read=await memory.dailyMemorySignals(traced,'alice',[1,2,3,999]);
    assert.equal(read.size,1);assert.equal(queries.filter(q=>q.startsWith('SELECT')).length,1,'one batched read');
    const detail=await memory.readMemory(db,'alice',[1],new Date('2026-10-02T00:00:00Z'));
    assert(detail[0].retrievability>0 && detail[0].retrievability<1);
    assert.equal(detail[0].due,(await get()).due.toISOString());
    assert.equal((await memory.readMemory(db,'bob',[1]))[0].stability,bob.stability);
    await db.query('SAVEPOINT unavailable');
    await db.query('ALTER TABLE question_memory_state RENAME TO memory_temporarily_unavailable');
    // Explicit failure also covers environments with an already-migrated public table.
    const broken={query:(text,values)=>text.startsWith('SELECT m.')?db.query('SELECT * FROM missing_memory_fixture'):db.query(text,values)};
    assert.equal((await memory.dailyMemorySignals(broken,'alice',[1])).size,0);
    assert.equal((await db.query('SELECT 42 AS value')).rows[0].value,42,'fallback leaves transaction usable');
    await db.query('ROLLBACK TO SAVEPOINT unavailable');
    await db.query('SAVEPOINT failed_write');
    const before=await get();
    const brokenWrite={query:(text,values)=>text.startsWith('INSERT INTO question_memory_state')?db.query('SELECT 1/0'):db.query(text,values)};
    const failure=answer(3,'A');
    await assert.rejects(learning.recordPractice(brokenWrite,'alice',[failure],'practice'));
    await db.query('ROLLBACK TO SAVEPOINT failed_write');
    assert.deepEqual(await get(),before);
    assert.equal((await db.query('SELECT * FROM practice_attempts WHERE event_id=$1',[failure.event_id])).rowCount,0);
    assert.equal((await db.query('SELECT * FROM question_answer_stats WHERE question_id=3')).rowCount,0);
    assert.equal(await get('alice',3),undefined);
    let calls=0;
    const api=load('app/api/learning/route.ts',{'@/lib/auth':{auth:{api:{getSession:async()=>null}}},'@/lib/question-transaction':{questionTransaction:async()=>{calls++;}},'@/lib/learning-service':learning,'@/lib/question-stats':stats});
    assert.equal((await api.POST(new Request('https://test.local/api/learning',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'answers',owner:'alice',mode:'practice',answers:[answer()]})}))).status,401);
    assert.equal(calls,0);
    const batch=[answer(3,'A','2026-10-01T00:00:00Z'),answer(3,'B','2026-09-25T00:00:00Z')];
    const batchQueries=[];
    await learning.recordPractice({query:(text,values)=>{batchQueries.push(text);return db.query(text,values);}},'alice',batch,'exam');
    const batchCard=memory.reviewMemory(memory.reviewMemory(undefined,false,now),true,new Date('2026-10-01T00:00:00Z'));
    const savedBatch=await get('alice',3);
    assert.equal(savedBatch.reps,2);assert.equal(+savedBatch.due,+batchCard.due);
    assert.equal(batchQueries.filter(text=>text.includes('question_memory_state')).length,2,'batch has one memory read and one upsert');
  } finally { await db.query('ROLLBACK').catch(()=>{});await db.end(); }
});

test('PostgreSQL concurrent account writes wait before reading a missing or existing card', {skip:process.env.MEMORY_DB_TEST!=='1',timeout:30000}, async () => {
  const clients=Array.from({length:2},()=>new pg.Client({connectionString:diagnosticTestConnectionString(),connectionTimeoutMillis:10000}));
  await Promise.all(clients.map(c=>c.connect()));
  try {
    await Promise.all(clients.map(c=>c.query('BEGIN')));
    await Promise.all(clients.map(c=>c.query("SET LOCAL statement_timeout='10s'")));
    const owner='fsrs-lock-fixture-'+randomUUID(), order=[];
    // Forward the actual service's account lock to two independent PostgreSQL
    // connections. Other statements are inert, so no shared test tables are needed.
    const wrapped=(index)=>({query:async(text,values)=>{
      if (text.includes('pg_advisory_xact_lock')) return clients[index].query(text,values);
      order.push(index); return {rows:[]};
    }});
    await learning.recordPractice(wrapped(0),owner,[],'practice');
    assert(order.length>0);order.length=0;
    const second=learning.recordPractice(wrapped(1),owner,[],'exam');
    const pid=(await clients[0].query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    let waiting=false;
    for(let n=0;n<40;n++) {
      const result=await clients[0].query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype=\'advisory\' AND NOT granted AND pg_blocking_pids(pid) @> ARRAY[$1::int]) AS waiting',[pid]);
      if(result.rows[0].waiting){waiting=true;break;}
    }
    assert(waiting,'second request is blocked at the transaction lock');
    assert.deepEqual(order,[],'no attempt/card reads before previous commit');
    await clients[0].query('COMMIT');await second;
    assert(order.every(index=>index===1) && order.length>0);
  } finally { await Promise.all(clients.map(async c=>{await c.query('ROLLBACK').catch(()=>{});await c.end();})); }
});
