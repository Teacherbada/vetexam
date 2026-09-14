import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import nextEnv from '@next/env';
import pg from 'pg';
import { diagnosticTestConnectionString } from './diagnostic-database.mjs';
const cache = new Map();
function load(path, mocks = {}) {
  if (cache.has(path) && !Object.keys(mocks).length) return cache.get(path);
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return { randomUUID };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    if (name.startsWith('.')) return load(posix.normalize(posix.join(posix.dirname(path), name)) + '.ts');
    throw new Error('Unexpected import ' + name);
  }, exports);
  if (!Object.keys(mocks).length) cache.set(path, exports); return exports;
}
const rules = load('lib/custom-plan.ts'), service = load('lib/custom-plan-service.ts'), diagnostic = load('lib/diagnostic-service.ts');
const chapters = load('data/exam-chapters.ts'), subject = chapters.EXAM_SUBJECTS[0], chapter = chapters.chapterGroups(subject)[0].chapters[0];
const config = { target: 3, deadline: '2026-10-01', preferUnanswered: true, scope: [{ subject, chapters: [] }] };
test('strict official scope, real dates, target boundaries and one-pass preferences', () => {
  assert.deepEqual(rules.parseCustomConfig(config), config);
  for (const changes of [{ target: 0 }, { target: 201 }, { target: 2.1 }, { target: '30' }, { deadline: '2026-02-30' }, { deadline: '2026-99-99' }, { target: null, deadline: null }, { scope: [] }, { scope: [{ subject: 'fake', chapters: [] }] }, { scope: [{ subject, chapters: ['fake'] }] }, { scope: [{ subject, chapters: [null] }] }, { userId: 'bob' }]) assert.equal(rules.parseCustomConfig({ ...config, ...changes }), null);
  assert(rules.parseCustomConfig({ ...config, target: null }));
  assert(rules.inCustomScope({ subject, chapter: null }, config));
  const narrowed = { ...config, scope: [{ subject, chapters: [chapter] }] };
  assert(rules.inCustomScope({ subject, chapter }, narrowed));
  assert(!rules.inCustomScope({ subject, chapter: null }, narrowed));
  assert(!rules.inCustomScope({ subject: chapters.EXAM_SUBJECTS[1], chapter }, narrowed));
});
test('remaining effective days, missed work suggestion, explicit target and ROC date', () => {
  const value = rules.customEstimate(290, { ...config, target: 30, deadline: '2026-09-23' }, '2026-09-15');
  assert.equal(value.days, 9); assert.equal(value.suggested, 33); assert.equal(value.target, 30); assert.equal(value.behind, true);
  assert.equal(rules.customEstimate(290, { ...config, target: null, deadline: '2026-09-23' }, '2026-09-15').target, 33);
  assert.equal(rules.customEstimate(9, config, '2026-10-02').overdue, true);
  assert.equal(rules.customEstimate(9, { ...config, deadline: null }, '2026-10-02').suggested, null);
  assert.equal(rules.customEstimate(0, config, '2026-10-02').estimatedDays, 0);
  assert.equal(rules.formatPlanDate('2026-06-30'), '民國 115/6/30');
  assert.equal(rules.parsePlanDate('115/6/30'), '2026-06-30');
  assert.equal(rules.parsePlanDate('115/2/30'), 'invalid');
  assert.equal(rules.parsePlanDate('2026/6/30'), 'invalid');
  assert.equal(rules.parsePlanDate(''), null);
});
test('custom API identity, origin, payload validation and hidden errors', async () => {
  const api = userId => load('app/api/study-plan/custom/route.ts', { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, '@/lib/auth': { auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } } }, '@/lib/question-transaction': { questionTransaction: () => { throw new Error('secret'); } } });
  const url = 'https://test.local/api/study-plan/custom';
  for (const method of ['GET', 'POST', 'PUT', 'PATCH']) assert.equal((await api(null)[method](new Request(url, { method }))).status, 401);
  for (const method of ['POST', 'PUT', 'PATCH']) {
    assert.equal((await api('alice')[method](new Request(url, { method, headers: { origin: 'https://evil.local' } }))).status, 403);
    for (const [body, status] of [['{', 400], ['x'.repeat(16385), 413], [JSON.stringify({ ...config, userId: 'bob' }), 400]]) assert.equal((await api('alice')[method](new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body }))).status, status);
  }
  const failed = await api('alice').GET(new Request(url)); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /secret/);
});
test('PostgreSQL custom scope, persistence, edits, pause, mode switching, next-day pools and completion', { skip: process.env.CUSTOM_PLAN_DB_TEST !== '1', timeout: 300000 }, async () => {
  nextEnv.loadEnvConfig(process.cwd()); const client = new pg.Client({ connectionString: diagnosticTestConnectionString(), connectionTimeoutMillis: 10000 }); await client.connect();
  try {
    await client.query('BEGIN'); await client.query(`CREATE TEMP TABLE study_plans(user_id text PRIMARY KEY,mode text);
      CREATE TEMP TABLE question_sets(id integer PRIMARY KEY,visibility text);
      CREATE TEMP TABLE questions(id integer PRIMARY KEY,question_set_id integer,subject text,chapter text,question text,answer text,option_a text,option_b text,option_c text,option_d text,option_e text,image_data_url text,explanation text);
      CREATE TEMP TABLE question_answer_stats(id bigserial,user_id text,question_id integer,is_correct boolean,selected_answer text,created_at timestamptz DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,question_id));
      INSERT INTO study_plans VALUES('alice','custom'),('bob','custom'),('empty','custom'),('coach','coach');INSERT INTO question_sets VALUES(1,'public'),(2,'private');`);
    for (const name of ['20260914_initial_diagnostic.sql', '20260915_diagnostic_confirmation.sql', '20260916_reinforcement_tasks.sql', '20260917_follow_ups.sql', '20260918_daily_tasks.sql', '20260919_custom_plans.sql', '20260919_custom_plans.sql']) await client.query(readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8').replaceAll('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE IF NOT EXISTS'));
    await client.query(`INSERT INTO questions(id,question_set_id,subject,chapter,question,answer,option_a,option_b,explanation)
      SELECT n,CASE WHEN n=9 THEN 2 ELSE 1 END,CASE WHEN n=8 THEN $3 ELSE $1 END,CASE WHEN n<=5 THEN $2 ELSE NULL END,'Fixture '||n,'A','One','Two','Explanation' FROM generate_series(1,9) n`, [subject, chapter, chapters.EXAM_SUBJECTS[1]]);
    await client.query("INSERT INTO question_answer_stats(user_id,question_id,is_correct,selected_answer) VALUES('alice',1,true,'A')");
    assert.equal((await service.previewCustomPlan(client, 'alice', config)).total, 6);
    const narrowed = { ...config, scope: [{ subject, chapters: [chapter] }] };
    assert.equal((await service.previewCustomPlan(client, 'alice', narrowed)).total, 4);
    await assert.rejects(service.saveCustomPlan(client, 'coach', config), e => e.status === 409);
    let view = await service.saveCustomPlan(client, 'alice', narrowed); const planId = view.plan.id;
    view = await service.startCustomDay(client, 'alice'); const taskId = view.task.id;
    assert.equal(view.task.total, 3); assert.equal(view.task.answered, 0); assert.doesNotMatch(JSON.stringify(view.task.current), /answer_key|subject|chapter/);
    assert.equal((await service.startCustomDay(client, 'alice')).task.id, taskId);
    const ids = async id => (await client.query('SELECT i.source_question_id AS id FROM diagnostic_items i JOIN custom_daily_tasks t ON t.session_id=i.session_id WHERE t.id=$1 ORDER BY i.position', [id])).rows.map(row => row.id);
    assert.deepEqual(await ids(taskId), [2, 3, 4]);
    await assert.rejects(service.answerCustomDay(client, 'bob', { taskId, position: 1, answer: 'A' }), e => e.status === 404);
    view = await service.answerCustomDay(client, 'alice', { taskId, position: 1, answer: 'B' }); assert.equal(view.plan.estimate.completed, 1);
    assert.equal((await service.answerCustomDay(client, 'alice', { taskId, position: 1, answer: 'B' })).task.answered, 1);
    await assert.rejects(service.answerCustomDay(client, 'alice', { taskId, position: 1, answer: 'A' }), e => e.status === 409);
    await client.query('COMMIT'); await client.query('BEGIN');
    view = await service.startCustomDay(client, 'alice'); assert.equal(view.task.id, taskId); assert.equal(view.task.answered, 1);
    await service.saveCustomPlan(client, 'alice', { ...config, target: 2, deadline: '2020-01-01' });
    view = await service.startCustomDay(client, 'alice'); assert.equal(view.plan.id, planId); assert.equal(view.task.total, 3); assert.deepEqual(await ids(taskId), [2, 3, 4]); assert.equal(view.plan.estimate.overdue, true); assert.equal(view.plan.config.target, 2);
    await service.setCustomPaused(client, 'alice', true); assert.equal((await service.startCustomDay(client, 'alice')).task.id, taskId);
    await assert.rejects(service.answerCustomDay(client, 'alice', { taskId, position: 2, answer: 'A' }), e => e.status === 409);
    await service.setCustomPaused(client, 'alice', false);
    await client.query("UPDATE study_plans SET mode='coach' WHERE user_id='alice'");
    await assert.rejects(service.startCustomDay(client, 'alice'), e => e.status === 409);
    assert.equal((await service.readCustomPlan(client, 'alice')).plan.id, planId);
    await client.query("UPDATE study_plans SET mode='custom' WHERE user_id='alice'");
    assert.equal((await service.startCustomDay(client, 'alice')).task.answered, 1);
    const before = (await service.readCustomPlan(client, 'alice')).plan.estimate.total;
    await client.query("INSERT INTO questions(id,question_set_id,subject,chapter,question,answer,option_a,option_b) VALUES(10,1,$1,$2,'New','A','One','Two')", [subject, chapter]);
    assert.equal((await service.startCustomDay(client, 'alice')).plan.estimate.total, before, 'new questions join on next local day');
    await client.query('UPDATE custom_daily_tasks SET local_date=local_date-1 WHERE id=$1', [taskId]);
    await client.query('UPDATE custom_plans SET pool_date=pool_date-1 WHERE id=$1', [planId]);
    view = await service.startCustomDay(client, 'alice'); assert.notEqual(view.task.id, taskId); assert.equal(view.task.total, 2); assert.equal(view.plan.estimate.total, before + 1); assert.equal(view.history.find(row => row.answered === 1).total, 3);
    assert(!(await ids(view.task.id)).includes(2), 'completed questions never loop');
    await assert.rejects(service.answerCustomDay(client, 'alice', { taskId, position: 2, answer: 'A' }), e => e.status === 409);
    await service.saveCustomPlan(client, 'bob', { ...narrowed, target: 20, preferUnanswered: false });
    let bob = await service.startCustomDay(client, 'bob'); assert.equal(bob.task.total, 6);
    while (!bob.task.completed) bob = await service.answerCustomDay(client, 'bob', { taskId: bob.task.id, position: bob.task.current.position, answer: 'A' });
    assert.equal(bob.plan.status, 'completed'); assert.equal(bob.plan.estimate.completed, 6); assert.equal(bob.plan.estimate.correct, 6); assert(bob.plan.completedAt);
    const bobId = bob.task.id;
    await client.query('UPDATE custom_daily_tasks SET local_date=local_date-1 WHERE id=$1', [bobId]);
    await client.query('UPDATE custom_plans SET pool_date=pool_date-1 WHERE id=$1', [bob.plan.id]);
    bob = await service.startCustomDay(client, 'bob'); assert.equal(bob.task, null); assert.equal(bob.plan.status, 'completed');
    await service.saveCustomPlan(client, 'empty', { ...config, scope: [{ subject, chapters: [chapters.chapterGroups(subject)[0].chapters[1]] }] });
    assert.equal((await service.startCustomDay(client, 'empty')).task, null);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM daily_tasks')).rows[0].n, 0, 'coach daily tables untouched');
    assert.equal((await client.query("SELECT count(*)::int AS n FROM question_answer_stats WHERE user_id='bob'")).rows[0].n, 6);
    await assert.rejects(diagnostic.answerDiagnostic(client, 'coach', { sessionId: (await client.query('SELECT session_id FROM custom_daily_tasks WHERE id=$1', [bobId])).rows[0].session_id, position: 1, answer: 'A' }, 'daily'), e => e.status === 404);
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
});
