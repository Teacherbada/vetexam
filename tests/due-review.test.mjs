import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { diagnosticTestConnectionString } from './diagnostic-database.mjs';
import { loadMemoryModule as load, memoryService as memory } from './memory-test-loader.mjs';

const rules = load('lib/due-review.ts');
const service = load('lib/due-review-service.ts', { './due-review': rules, './question-memory-service': memory });
const learning = load('lib/learning-service.ts', { './question-memory-service': memory, './question-stats': load('lib/question-stats.ts'), './question-state': load('lib/question-state.ts') });
const now = new Date('2026-09-25T15:59:59.000Z');

test('Taipei midnight and rolling seven-day boundaries; strict bounded limits', () => {
  assert.equal(rules.reviewBoundaries(now).todayEnd.toISOString(), '2026-09-25T16:00:00.000Z');
  assert.equal(rules.reviewBoundaries(new Date('2026-09-25T16:00:00Z')).todayEnd.toISOString(), '2026-09-26T16:00:00.000Z');
  assert.equal(rules.reviewBoundaries(now).upcomingEnd.toISOString(), '2026-10-02T15:59:59.000Z');
  assert.equal(rules.reviewLimit(null), 20);
  for (const n of ['5','10','20','30','50']) assert.equal(rules.reviewLimit(n), Number(n));
  for (const n of ['0','-1','1000','51','NaN','20.0','05','']) assert.equal(rules.reviewLimit(n), null);
});

test('API requires session, ignores client owner, rejects invalid limits, uses private no-store and consistent read snapshot', async () => {
  let owner = null, reads = 0, fail = false;
  const api = load('app/api/review/due/route.ts', {
    '@/lib/auth': { auth: { api: { getSession: async () => owner ? { user: { id: owner } } : null } } },
    '@/lib/due-review': rules,
    '@/lib/question-transaction': { questionTransaction: async fn => fn({ query: async sql => assert.match(sql, /REPEATABLE READ READ ONLY/) }) },
    '@/lib/due-review-service': { readDueReview: async (_client, id, limit) => { reads++; assert.equal(id,'alice'); if (fail) throw Error(); return { owner:id, limit, queue:[] }; } },
  });
  const request = query => new Request('https://example.test/api/review/due'+query);
  assert.equal((await api.GET(request(''))).status,401); assert.equal(reads,0);
  owner='alice';
  assert.equal((await api.GET(request('?limit=5000'))).status,400); assert.equal(reads,0);
  const response = await api.GET(request('?owner=bob&limit=50'));
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(await response.json(),{owner:'alice',limit:50,queue:[]});
  fail=true; assert.equal((await api.GET(request(''))).status,503);
});

test('PostgreSQL due review: eligibility, counts, ordering, limits and existing practice rescheduling', { skip: process.env.MEMORY_DB_TEST !== '1', timeout:120000 }, async () => {
  const db = new pg.Client({connectionString:diagnosticTestConnectionString(),connectionTimeoutMillis:10000});
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`CREATE TEMP TABLE "user"(id text PRIMARY KEY); INSERT INTO "user" VALUES('alice'),('bob');
      CREATE TEMP TABLE question_sets(id integer PRIMARY KEY,visibility text,exam_year integer,name text);
      INSERT INTO question_sets VALUES(1,'public',115,'fixture'),(2,'private',115,'private');
      CREATE TEMP TABLE questions(id integer PRIMARY KEY,question_set_id integer,question_number integer,subject text,question text,
        answer text,option_a text,option_b text,option_c text,option_d text,option_e text,explanation text,image_data_url text);
      INSERT INTO questions SELECT n,1,n,'subject','question '||n,'A','a','b','c','d','e','explanation','data:image/png;base64,fixture' FROM generate_series(1,70) n;
      CREATE TEMP TABLE question_answer_stats(id bigserial,user_id text,question_id integer,is_correct boolean,selected_answer text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,question_id));`);
    for (const name of ['20260925_account_learning.sql','20260925_question_memory_state.sql']) await db.query(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8').replaceAll('CREATE TABLE','CREATE TEMP TABLE'));
    let view = await service.readDueReview(db,'alice',20,now);
    assert.deepEqual([view.dueNow,view.dueToday,view.upcoming7Days,view.queue.length],[0,0,0,0]);
    const answer = (id, selected_answer='A') => ({question_id:id,selected_answer,event_id:randomUUID(),answered_at:now.toISOString()});
    await learning.recordPractice(db,'alice',Array.from({length:70},(_,n)=>answer(n+1)),'practice');
    await learning.recordPractice(db,'bob',[answer(1)],'practice');
    await db.query(`UPDATE question_memory_state SET due=$1, last_review=$1::timestamptz-interval '1 day',stability=3 WHERE user_id='alice'`,[now]);
    await db.query("UPDATE questions SET question_set_id=2 WHERE id=1; DELETE FROM questions WHERE id=2; UPDATE questions SET answer='X' WHERE id=3; UPDATE questions SET option_a='  ' WHERE id=4");
    await db.query("UPDATE question_memory_state SET due=$1 WHERE question_id=5 AND user_id='alice'",[new Date(+now+1)]);
    await db.query("UPDATE question_memory_state SET due=$1 WHERE question_id=6 AND user_id='alice'",[rules.reviewBoundaries(now).todayEnd]);
    await db.query("UPDATE question_memory_state SET due=$1 WHERE question_id=7 AND user_id='alice'",[rules.reviewBoundaries(now).upcomingEnd]);
    await db.query("UPDATE question_memory_state SET due=$1 WHERE question_id=8 AND user_id='alice'",[new Date(+rules.reviewBoundaries(now).upcomingEnd+1)]);
    await db.query("UPDATE questions SET answer=' E ' WHERE id=9");
    const queries=[];
    view=await service.readDueReview({query:(sql,args)=>{queries.push(sql);return db.query(sql,args);}},'alice',50,now);
    assert.deepEqual([view.dueNow,view.dueToday,view.upcoming7Days],[62,63,3]);
    assert.equal(view.queue.length,50); assert.equal(queries.length,3,'constant query count, no per-question memory reads');
    assert.deepEqual(view.queue.map(q=>q.id),Array.from({length:50},(_,n)=>n+9));
    assert.equal(view.queue[0].answer,'E'); assert.equal(view.queue[0].options.length,5); assert.match(view.queue[0].imageDataUrl,/^data:image/);
    assert.equal((await service.readDueReview(db,'bob',20,now)).dueNow,0);
    await assert.rejects(service.readDueReview(db,'alice',1000,now));
    // More than limit cards share due: official retrievability must break cutoff ties.
    await db.query("UPDATE question_memory_state SET stability=0.1 WHERE question_id=70 AND user_id='alice'");
    view=await service.readDueReview(db,'alice',5,now); assert.equal(view.queue[0].id,70);
    assert.deepEqual(view.queue,(await service.readDueReview(db,'alice',5,now)).queue);
    await db.query("UPDATE question_memory_state SET due=$1::timestamptz-interval '1 minute' WHERE question_id=67 AND user_id='alice'",[now]);
    assert.equal((await service.readDueReview(db,'alice',5,now)).queue[0].id,67,'earliest due takes precedence over retrievability');
    await db.query("UPDATE question_memory_state SET due=$1 WHERE question_id=67 AND user_id='alice'",[now]);
    await db.query("UPDATE question_memory_state SET last_review=$1::timestamptz-interval '2 days',stability=0 WHERE question_id IN (68,69) AND user_id='alice'",[now]);
    await db.query("UPDATE question_memory_state SET last_review=$1::timestamptz-interval '3 days' WHERE question_id=69 AND user_id='alice'",[now]);
    assert.deepEqual((await service.readDueReview(db,'alice',5,now)).queue.slice(0,2).map(q=>q.id),[69,68]);
    for (const [id,selected] of [[10,'A'],[11,'B']]) {
      const before=(await db.query("SELECT * FROM question_memory_state WHERE user_id='alice' AND question_id=$1",[id])).rows[0];
      const event=answer(id,selected); await learning.recordPractice(db,'alice',[event],'practice');
      const after=(await db.query("SELECT * FROM question_memory_state WHERE user_id='alice' AND question_id=$1",[id])).rows[0];
      assert.equal(after.reps,before.reps+1); assert(after.due>now);
      assert.equal(+after.due,+memory.reviewMemory(before,selected==='A',now).due);
      await learning.recordPractice(db,'alice',[event],'practice');
      assert.deepEqual((await db.query("SELECT * FROM question_memory_state WHERE user_id='alice' AND question_id=$1",[id])).rows[0],after);
    }
    assert.equal((await service.readDueReview(db,'alice',50,now)).dueNow,60);
    // Two devices deliver distinct attempts, then replay one and deliver an older
    // timestamp. The separate Phase 1 two-connection test verifies lock ordering.
    const deviceA=answer(12), deviceB={...answer(12,'B'),answered_at:new Date(+now-3600000).toISOString()};
    const before=(await db.query("SELECT reps FROM question_memory_state WHERE user_id='alice' AND question_id=12")).rows[0].reps;
    await learning.recordPractice(db,'alice',[deviceA],'practice');
    await learning.recordPractice(db,'alice',[deviceB],'practice');
    await learning.recordPractice(db,'alice',[deviceA,deviceB],'practice');
    const after=(await db.query("SELECT * FROM question_memory_state WHERE user_id='alice' AND question_id=12")).rows[0];
    assert.equal(after.reps,before+2); assert.equal(+after.last_review,+now); assert(after.due>now);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM practice_attempts WHERE user_id='alice' AND event_id=ANY($1::uuid[])",[[deviceA.event_id,deviceB.event_id]])).rows[0].n,2);
  } finally { await db.query('ROLLBACK').catch(()=>{}); await db.end(); }
});
