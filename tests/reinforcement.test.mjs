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
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === 'server-only') return {};
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
const chapters = load('data/exam-chapters.ts');
const diagnostic = load('lib/diagnostic.ts', { '../data/exam-chapters': chapters });
const weakness = load('lib/weakness.ts', { '../data/exam-chapters': chapters });
const rules = load('lib/reinforcement.ts', { '../data/exam-chapters': chapters });
const service = load('lib/diagnostic-service.ts', {
  'node:crypto': { randomUUID }, '@/data/exam-chapters': chapters, '@/lib/diagnostic': diagnostic,
  '@/lib/question-answer': load('lib/question-answer.ts'), '@/lib/question-stats': load('lib/question-stats.ts'),
});
const confirmation = load('lib/confirmation-service.ts', { '@/lib/diagnostic-service': service, '@/lib/weakness': weakness });
const reinforcement = load('lib/reinforcement-service.ts', { 'node:crypto': { randomUUID }, '@/lib/diagnostic-service': service,
  '@/lib/confirmation-service': confirmation, '@/lib/reinforcement': rules });
const subject = chapters.EXAM_SUBJECTS[0];
const names = chapters.chapterGroups(subject)[0].chapters.slice(0, 3);
const chapter = names[0];

test('priority advances beyond the original top two and ignores insufficient/good chapters', () => {
  const evidence = names.flatMap((chapter, c) => Array.from({ length: 5 }, (_, i) => ({ question_id: c * 10 + i, subject, chapter,
    is_correct: i < c, answered_at: new Date().toISOString(), kind: 'confirmation' })));
  const analysis = weakness.buildWeaknessAnalysis(evidence);
  assert.equal(analysis.priorities.length, 2);
  assert.equal(rules.nextReinforcement(analysis, []).chapter, names[0]);
  assert.equal(rules.nextReinforcement(analysis, names.slice(0, 2).map(chapter => ({ subject, chapter }))).chapter, names[2]);
  assert.equal(rules.nextReinforcement(analysis, names.map(chapter => ({ subject, chapter }))), null);
  assert.equal(rules.nextReinforcement(weakness.buildWeaknessAnalysis([]), []), null);
});
test('verification uses exact subject/chapter, unseen then oldest, recent/excluded only as fallback', () => {
  const candidates = Array.from({ length: 12 }, (_, id) => ({ id, subject, chapter, last_answered: id < 6 ? null : `2026-08-${10 + id}T00:00:00Z` }));
  const excluded = new Set([0, 1, 6]);
  const selected = rules.selectVerificationQuestions([...candidates, { ...candidates[0], id: 99, chapter: null }, { ...candidates[0], id: 98, subject: chapters.EXAM_SUBJECTS[1] }], subject, chapter, excluded, () => 0);
  assert.deepEqual(selected.map(r => r.id), [2, 3, 4, 5, 7]);
  const fallback = rules.selectVerificationQuestions(candidates.slice(6, 9), subject, chapter, new Set([6, 7, 8]), () => 0);
  assert.deepEqual(fallback.map(r => r.id), [6, 7, 8]);
  assert.equal(rules.selectVerificationQuestions(candidates, subject, 'invented', excluded).length, 0);
  assert.equal(rules.selectVerificationQuestions([...candidates.slice(0, 2), candidates[0]], subject, chapter, excluded).length, 2);
});
test('80 percent threshold and minimum three questions, including small-pool boundaries', () => {
  for (const [correct, total, expected] of [[4, 5, true], [3, 5, false], [3, 3, true], [2, 3, false], [4, 4, true], [3, 4, false], [2, 2, false], [1, 1, false], [0, 0, false]]) {
    assert.equal(rules.reinforcementPassed(correct, total), expected);
  }
  assert.equal(rules.reinforcementPassed(3, 5, 0.6), true);
});
test('commands reject identity injection, stale-cycle omissions and invalid actions', () => {
  const command = { action: 'review', taskId: randomUUID(), reviewAttempt: 1 };
  assert.deepEqual(rules.parseReinforcementCommand(command), command);
  for (const invalid of [{ ...command, userId: 'bob' }, { ...command, reviewAttempt: 0 }, { ...command, action: 'pass' }, { ...command, reviewAttempt: undefined }]) assert.equal(rules.parseReinforcementCommand(invalid), null);
});
test('API authenticates every method, blocks cross-origin and oversized/malformed bodies, hides outages', async () => {
  function api(userId) {
    return load('app/api/study-plan/reinforcement/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } } },
      '@/lib/question-transaction': { questionTransaction: () => { throw new Error('secret'); } },
      '@/lib/diagnostic-service': service, '@/lib/reinforcement-service': reinforcement, '@/lib/diagnostic': diagnostic, '@/lib/reinforcement': rules,
    });
  }
  const url = 'https://test.local/api/study-plan/reinforcement';
  for (const method of ['GET', 'POST', 'PATCH', 'PUT']) assert.equal((await api(null)[method](new Request(url, { method }))).status, 401);
  for (const method of ['POST', 'PATCH', 'PUT']) assert.equal((await api('alice')[method](new Request(url, { method, headers: { origin: 'https://evil.local' } }))).status, 403);
  for (const method of ['PATCH', 'PUT']) {
    assert.equal((await api('alice')[method](new Request(url, { method }))).status, 415);
    for (const [body, status] of [['{', 400], ['x'.repeat(1025), 413], [JSON.stringify({ taskId: randomUUID(), sessionId: randomUUID(), position: 1, answer: 'A', userId: 'bob' }), 400]]) {
      assert.equal((await api('alice')[method](new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body }))).status, status);
    }
  }
  const failed = await api('alice').GET(new Request(url)); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /secret/);
});

test('PostgreSQL: single persistent task, review gate, exact questions, fail/review/retry/pass, baseline and attempt history', { skip: process.env.REINFORCEMENT_DB_TEST !== '1', timeout: 300000 }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: diagnosticTestConnectionString(), connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE study_plans (user_id text PRIMARY KEY, mode text);
      CREATE TEMP TABLE question_sets (id integer PRIMARY KEY, visibility text);
      CREATE TEMP TABLE questions (id integer PRIMARY KEY, question_set_id integer, subject text, chapter text, question text, answer text,
        option_a text, option_b text, option_c text, option_d text, option_e text, image_data_url text);
      CREATE TEMP TABLE question_answer_stats (id bigserial, user_id text, question_id integer, is_correct boolean, selected_answer text,
        created_at timestamptz DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, question_id));
      INSERT INTO study_plans VALUES ('alice','coach'), ('bob','coach'), ('custom','custom');
      INSERT INTO question_sets VALUES (1,'public'), (2,'private');`);
    const sql = name => readFileSync(new URL('../migrations/' + name, import.meta.url), 'utf8').replaceAll('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE IF NOT EXISTS');
    await client.query(sql('20260914_initial_diagnostic.sql'));
    await client.query(sql('20260915_diagnostic_confirmation.sql'));
    await client.query(sql('20260916_reinforcement_tasks.sql'));
    await client.query(sql('20260916_reinforcement_tasks.sql'));
    const initialId = randomUUID(), confirmationId = randomUUID();
    await client.query("INSERT INTO diagnostic_sessions(id,user_id,completed_at) VALUES ($1,'alice',CURRENT_TIMESTAMP)", [initialId]);
    await client.query("INSERT INTO diagnostic_sessions(id,user_id,kind,parent_session_id,completed_at) VALUES ($1,'alice','confirmation',$2,CURRENT_TIMESTAMP)", [confirmationId, initialId]);
    await client.query(`INSERT INTO questions (id,question_set_id,subject,chapter,question,answer,option_a,option_b)
      SELECT i,1,$1,CASE WHEN i <= 20 THEN $2 ELSE $3 END,'Fixture','A','A','B' FROM generate_series(1,30) i`, [subject, chapter, names[1]]);
    await client.query(`INSERT INTO diagnostic_items(session_id,position,question_id,source_question_id,subject,chapter,question,options,answer_key,selected_answer,is_correct,answered_at)
      SELECT $1,i,i,i,$2,$3,'Original','["A","B"]'::jsonb,'A','B',false,CURRENT_TIMESTAMP FROM generate_series(1,5) i`, [confirmationId, subject, chapter]);
    // A first-answer record that predates verification must remain historical evidence, even when retried.
    await client.query("INSERT INTO question_answer_stats(user_id,question_id,is_correct,selected_answer,created_at) VALUES ('alice',20,false,'B',CURRENT_TIMESTAMP - interval '10 days')");
    const baseline = await confirmation.readWeaknessAnalysis(client, 'alice');
    assert.equal(baseline.priorities[0].chapter, chapter);
    await assert.rejects(reinforcement.startReinforcement(client, 'bob'), e => e.status === 409);
    await assert.rejects(reinforcement.startReinforcement(client, 'custom'), e => e.status === 409);
    let view = await reinforcement.startReinforcement(client, 'alice');
    const taskId = view.task.id;
    const command = (action, reviewAttempt = view.task.review_count) => reinforcement.changeReinforcement(client, 'alice', { taskId, action, reviewAttempt });
    assert.equal(view.task.status, 'reviewing'); assert.equal(view.task.chapter, chapter);
    assert.equal((await reinforcement.startReinforcement(client, 'alice')).task.id, taskId);
    await assert.rejects(reinforcement.changeReinforcement(client, 'bob', { taskId, action: 'review', reviewAttempt: 1 }), e => e.status === 404);
    await assert.rejects(command('verify'), e => e.status === 409);
    view = await command('review'); assert.equal(view.task.status, 'reviewed'); assert(view.task.review_completed_at); assert.equal(view.session, null);
    assert.deepEqual(await confirmation.readWeaknessAnalysis(client, 'alice'), baseline);
    view = await command('verify'); const firstSession = view.session.id;
    assert.equal(view.task.status, 'verifying'); assert.equal(view.session.total, 5); assert.equal(view.attempts[0].repeatedCount, 0);
    assert.equal((await command('verify')).session.id, firstSession);
    const firstIds = (await client.query('SELECT source_question_id,subject,chapter FROM diagnostic_items WHERE session_id=$1', [firstSession])).rows;
    assert(firstIds.every(r => r.subject === subject && r.chapter === chapter && r.source_question_id > 5 && r.source_question_id < 20));
    assert.doesNotMatch(JSON.stringify(view), /answer_key|selected_answer/);
    await assert.rejects(service.answerDiagnostic(client, 'alice', { sessionId: firstSession, position: 1, answer: 'B' }), e => e.status === 404);
    await assert.rejects(reinforcement.answerReinforcement(client, 'alice', taskId, { sessionId: confirmationId, position: 1, answer: 'B' }), e => e.status === 404);
    view = await reinforcement.answerReinforcement(client, 'alice', taskId, { sessionId: firstSession, position: 1, answer: 'B' });
    await client.query('COMMIT'); await client.query('BEGIN');
    view = await reinforcement.readReinforcement(client, 'alice'); assert.equal(view.session.answered, 1);
    view = await command('defer'); assert.equal(view.task.status, 'deferred');
    assert.equal((await reinforcement.startReinforcement(client, 'alice')).task.id, taskId);
    view = await command('resume'); assert.equal(view.task.status, 'verifying'); assert.equal(view.session.answered, 1);
    view = await reinforcement.answerReinforcement(client, 'alice', taskId, { sessionId: firstSession, position: 1, answer: 'B' }); assert.equal(view.session.answered, 1);
    await assert.rejects(reinforcement.answerReinforcement(client, 'alice', taskId, { sessionId: firstSession, position: 1, answer: 'A' }), e => e.status === 409);
    for (let position = 2; position <= 5; position++) view = await reinforcement.answerReinforcement(client, 'alice', taskId, { sessionId: firstSession, position, answer: 'B' });
    assert.equal(view.task.status, 'needs_work'); assert.equal(view.attempts[0].correct, 0);
    await assert.rejects(command('verify'), e => e.status === 409);
    view = await command('again'); assert.equal(view.task.review_count, 2); assert.equal(view.task.review_completed_at, null); assert.equal(view.session, null);
    await assert.rejects(command('review', 1), e => e.status === 409);
    await assert.rejects(command('verify'), e => e.status === 409);
    view = await command('review'); view = await command('verify');
    const secondSession = view.session.id;
    assert.notEqual(secondSession, firstSession);
    const secondIds = (await client.query('SELECT source_question_id FROM diagnostic_items WHERE session_id=$1', [secondSession])).rows;
    assert(secondIds.every(r => !firstIds.some(old => old.source_question_id === r.source_question_id)));
    for (let position = 1; position <= 5; position++) view = await reinforcement.answerReinforcement(client, 'alice', taskId, { sessionId: secondSession, position, answer: position === 5 ? 'B' : 'A' });
    assert.equal(view.task.status, 'short_term'); assert.equal(view.attempts[1].correct, 4); assert.equal(view.attempts.length, 2);
    assert.equal(view.completed.length, 1); assert.equal(view.next, null);
    assert.deepEqual(await confirmation.readWeaknessAnalysis(client, 'alice'), baseline);
    assert.equal((await service.readDiagnostic(client, 'alice')).session.id, initialId);
    // Direct unique constraint protects callers that bypass service serialization.
    await client.query('SAVEPOINT uniqueness');
    await client.query("UPDATE reinforcement_tasks SET status='needs_work' WHERE id=$1", [taskId]);
    await assert.rejects(client.query(`INSERT INTO reinforcement_tasks(id,user_id,subject,chapter,source_session_id,source_analysis,status)
      VALUES ($1,'alice',$2,$3,$4,'{}','reviewing')`, [randomUUID(), subject, names[1], initialId]), e => e.code === '23505');
    await client.query('ROLLBACK TO SAVEPOINT uniqueness');
    // Exhausted pool: use three repeated questions, including an older general-practice answer.
    await client.query("UPDATE reinforcement_tasks SET status='needs_work' WHERE id=$1", [taskId]);
    view = await reinforcement.readReinforcement(client, 'alice'); view = await command('again'); view = await command('review');
    await client.query('UPDATE questions SET question_set_id=2 WHERE id NOT IN (1,2,20)');
    view = await command('verify'); assert.equal(view.session.total, 3); assert.equal(view.attempts.at(-1).repeatedCount, 3);
    for (let position = 1; position <= 3; position++) view = await reinforcement.answerReinforcement(client, 'alice', taskId, { sessionId: view.session.id, position, answer: 'A' });
    assert.equal(view.task.status, 'short_term');
    const after = await confirmation.readWeaknessAnalysis(client, 'alice');
    assert.equal(after.subjects[0].chapters[0].count, baseline.subjects[0].chapters[0].count);
    assert.equal(after.subjects[0].chapters[0].correct, baseline.subjects[0].chapters[0].correct);
    // No questions creates no session; two questions may finish but never imply mastery.
    await client.query("UPDATE reinforcement_tasks SET status='needs_work' WHERE id=$1", [taskId]);
    view = await reinforcement.readReinforcement(client, 'alice'); view = await command('again'); view = await command('review');
    await client.query('UPDATE questions SET question_set_id=2');
    await assert.rejects(command('verify'), e => e.status === 409);
    assert.equal((await reinforcement.readReinforcement(client, 'alice')).task.status, 'reviewed');
    await client.query('UPDATE questions SET question_set_id=1 WHERE id IN (1,2)');
    view = await command('verify'); assert.equal(view.session.total, 2);
    for (let position = 1; position <= 2; position++) view = await reinforcement.answerReinforcement(client, 'alice', taskId, { sessionId: view.session.id, position, answer: 'A' });
    assert.equal(view.task.status, 'needs_work'); assert.equal(view.attempts.at(-1).correct, 2);
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
});
