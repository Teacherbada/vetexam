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
const rules = load('lib/weakness.ts', { '../data/exam-chapters': chapters });
const service = load('lib/diagnostic-service.ts', {
  'node:crypto': { randomUUID }, '@/data/exam-chapters': chapters, '@/lib/diagnostic': diagnostic,
  '@/lib/question-answer': load('lib/question-answer.ts'), '@/lib/question-stats': load('lib/question-stats.ts'),
});
const confirmation = load('lib/confirmation-service.ts', { '@/lib/diagnostic-service': service, '@/lib/weakness': rules });
const subject = chapters.EXAM_SUBJECTS[0];
const chapter = chapters.chapterGroups(subject)[0].chapters[0];
const now = Date.parse('2026-09-15T12:00:00Z');
const record = (id, correct = false, extra = {}) => ({ question_id: id, subject, chapter, is_correct: correct, answered_at: '2026-09-14T12:00:00Z', kind: 'confirmation', ...extra });
const analysis = rows => rules.buildWeaknessAnalysis(rows, now);
const metric = rows => analysis(rows).subjects[0].chapters[0];

test('one error, repeated identical question and initial-only samples cannot establish a chapter weakness', () => {
  assert.equal(metric([record(1)]).status, 'insufficient');
  assert.equal(metric(Array.from({ length: 20 }, () => record(1))).count, 1);
  assert.equal(metric(Array.from({ length: 10 }, (_, i) => record(i, false, { kind: 'initial' }))).status, 'insufficient');
  assert.equal(analysis([record(1, false, { chapter: null })]).priorities.length, 0);
  assert.equal(metric([record(1, false, { chapter: 'invented' })]).count, 0);
});
test('five distinct questions, confirmation evidence and exact 60/80 percent boundaries', () => {
  const rows = Array.from({ length: 5 }, (_, i) => record(i, i < 2));
  assert.equal(metric(rows).status, 'strengthen');
  assert.equal(metric(rows.map((r, i) => ({ ...r, is_correct: i < 3 }))).status, 'review');
  assert.equal(metric(rows.map((r, i) => ({ ...r, is_correct: i < 4 }))).status, 'good');
  assert.equal(metric(rows.map((r, i) => ({ ...r, kind: i < 2 ? 'confirmation' : 'initial' }))).status, 'insufficient');
});
test('latest answer wins without inflating samples, stale records expire, and recent mistakes affect status', () => {
  const rows = Array.from({ length: 20 }, (_, i) => record(i, true, { answered_at: '2026-09-01T12:00:00Z' }));
  const newer = rows.slice(0, 10).map(r => ({ ...r, is_correct: false, answered_at: '2026-09-14T12:00:00Z' }));
  const result = metric([...rows, ...newer]);
  assert.equal(result.count, 20); assert.equal(result.recentAccuracy, 0); assert.equal(result.status, 'strengthen');
  assert.equal(metric(rows.map(r => ({ ...r, answered_at: '2026-07-01T00:00:00Z' }))).count, 0);
  const tie = rules.recentEvidence([record(1, true, { kind: 'first' }), record(1, false)], now);
  assert.equal(tie[0].kind, 'confirmation');
});
test('priority list is capped and unclassified answers only contribute to subject performance', () => {
  const names = chapters.chapterGroups(subject)[0].chapters.slice(0, 3);
  const rows = names.flatMap((name, c) => Array.from({ length: 5 }, (_, i) => record(c * 10 + i, false, { chapter: name })));
  assert.equal(analysis(rows).priorities.length, 2);
  const unclassified = rows.map(r => ({ ...r, chapter: null }));
  assert.equal(analysis(unclassified).subjects[0].status, 'strengthen');
  assert.equal(analysis(unclassified).subjects[0].unclassified, 15);
  assert.equal(analysis(unclassified).priorities.length, 0);
});
test('confirmation selection excludes recent repeats, groups enough distinct chapter questions and handles exhaustion', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: i, subject, chapter, last_answered: i < 5 ? '2026-09-14T00:00:00Z' : i < 25 ? null : '2026-08-01T00:00:00Z' }));
  const selected = rules.selectConfirmationQuestions(rows, [subject], analysis([]), now, () => 0.5);
  assert.equal(selected.length, 20); assert(selected.every(r => r.id >= 5 && r.id < 25));
  assert.equal(new Set(selected.map(r => r.id)).size, 20);
  assert.deepEqual(rules.selectConfirmationQuestions(rows.slice(0, 5), [subject], analysis([]), now), []);
  assert.equal(rules.selectConfirmationQuestions(rows.slice(0, 8), [subject], analysis([]), now).length, 3);
  const unknown = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, subject, chapter: null, last_answered: null }));
  const older = rows.slice(25);
  assert(rules.selectConfirmationQuestions([...older, ...unknown], [subject], analysis([]), now).every(row => row.id >= 100));
});
test('targets require completed initial results and respect low samples and maximum two subjects', () => {
  const initial = { completed: true, results: chapters.EXAM_SUBJECTS.map((subject, i) => ({ subject, insufficient: i === 0, answered: 10, correct: i })) };
  assert.equal(rules.confirmationTargets(initial).length, 2);
  assert(!rules.confirmationTargets(initial).includes(subject));
  assert.deepEqual(rules.confirmationTargets({ ...initial, completed: false }), []);
});
test('confirmation API uses session authentication and validates origin, body, ownership fields and outages', async () => {
  function api(userId) {
    return load('app/api/study-plan/confirmation/route.ts', {
      'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
      '@/lib/auth': { auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } } },
      '@/lib/question-transaction': { questionTransaction: () => { throw new Error('secret'); } },
      '@/lib/diagnostic-service': service, '@/lib/confirmation-service': confirmation, '@/lib/diagnostic': diagnostic,
    });
  }
  const url = 'https://test.local/api/study-plan/confirmation';
  for (const method of ['GET', 'POST', 'PUT']) assert.equal((await api(null)[method](new Request(url, { method }))).status, 401);
  assert.equal((await api('alice').POST(new Request(url, { method: 'POST', headers: { origin: 'https://evil.local' } }))).status, 403);
  for (const [body, expected] of [['{', 400], ['x'.repeat(1025), 413], [JSON.stringify({ sessionId: randomUUID(), position: 1, answer: 'A', userId: 'bob' }), 400]]) {
    assert.equal((await api('alice').PUT(new Request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }))).status, expected);
  }
  const failed = await api('alice').GET(new Request(url)); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /secret/);
});

test('PostgreSQL migration preserves initial data; confirmation reuses records, isolates accounts and resumes across commits', { skip: process.env.WEAKNESS_DB_TEST !== '1', timeout: 240000 }, async () => {
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
    const phase2 = readFileSync(new URL('../migrations/20260914_initial_diagnostic.sql', import.meta.url), 'utf8').replaceAll('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE IF NOT EXISTS');
    await client.query(phase2);
    const initialId = randomUUID();
    await client.query("INSERT INTO diagnostic_sessions(id,user_id,completed_at) VALUES ($1,'alice',CURRENT_TIMESTAMP)", [initialId]);
    await client.query(`INSERT INTO questions (id,question_set_id,subject,chapter,question,answer,option_a,option_b)
      SELECT i,1,$1,$2,'Fixture','A','A','B' FROM generate_series(1,40) i`, [subject, chapter]);
    await client.query(`INSERT INTO diagnostic_items(session_id,position,question_id,source_question_id,subject,chapter,question,options,answer_key,selected_answer,is_correct,answered_at)
      SELECT $1,i,i,i,$2,$3,'Original','["A","B"]'::jsonb,'A','B',false,CURRENT_TIMESTAMP FROM generate_series(1,10) i`, [initialId, subject, chapter]);
    const migrate = readFileSync(new URL('../migrations/20260915_diagnostic_confirmation.sql', import.meta.url), 'utf8');
    await client.query(migrate); await client.query(migrate);
    assert.equal((await service.readDiagnostic(client, 'alice')).session.id, initialId);
    const before = await confirmation.readConfirmation(client, 'alice');
    assert.equal(before.analysis.subjects[0].chapters[0].status, 'insufficient');
    assert.equal(before.available[0].count, 20);
    await assert.rejects(confirmation.startConfirmation(client, 'bob'), error => error.status === 409);
    await assert.rejects(confirmation.startConfirmation(client, 'custom'), error => error.status === 409);
    let view = await confirmation.startConfirmation(client, 'alice');
    const confirmationId = view.session.id;
    assert.notEqual(confirmationId, initialId); assert.equal(view.session.total, 20);
    assert.equal((await confirmation.startConfirmation(client, 'alice')).session.id, confirmationId);
    assert(view.session.current.questionId > 10);
    assert.doesNotMatch(JSON.stringify(view), /answer_key|selected_answer/);
    assert.equal((await service.startDiagnostic(client, 'alice')).session.id, initialId);
    await assert.rejects(service.answerDiagnostic(client, 'alice', { sessionId: confirmationId, position: 1, answer: 'B' }), error => error.status === 404);
    await assert.rejects(confirmation.answerConfirmation(client, 'bob', { sessionId: confirmationId, position: 1, answer: 'B' }), error => error.status === 404);
    await assert.rejects(confirmation.answerConfirmation(client, 'alice', { sessionId: initialId, position: 1, answer: 'B' }), error => error.status === 404);
    await confirmation.answerConfirmation(client, 'alice', { sessionId: confirmationId, position: 1, answer: 'B' });
    await client.query('COMMIT'); await client.query('BEGIN');
    view = await confirmation.readConfirmation(client, 'alice'); assert.equal(view.session.answered, 1);
    assert.equal((await confirmation.answerConfirmation(client, 'alice', { sessionId: confirmationId, position: 1, answer: 'B' })).session.answered, 1);
    await assert.rejects(confirmation.answerConfirmation(client, 'alice', { sessionId: confirmationId, position: 1, answer: 'A' }), error => error.status === 409);
    for (let position = 2; position <= 20; position++) view = await confirmation.answerConfirmation(client, 'alice', { sessionId: confirmationId, position, answer: 'B' });
    assert.equal(view.session.completed, true);
    assert.equal(view.analysis.subjects[0].chapters[0].status, 'strengthen');
    assert.equal(view.analysis.subjects[0].chapters[0].count, 30);
    assert.equal(view.analysis.subjects[0].chapters[0].confirmationCount, 20);
    assert.equal(view.analysis.priorities.length, 1);
    const next = await confirmation.startConfirmation(client, 'alice');
    assert.notEqual(next.session.id, confirmationId); assert.equal(next.session.total, 10);
    assert.equal((await service.readDiagnostic(client, 'alice')).session.id, initialId);
    // Constraint tests use savepoints so intentional failures don't abort fixtures.
    async function fails(query, values, code) {
      await client.query('SAVEPOINT constraint_check');
      try { await assert.rejects(client.query(query, values), error => error.code === code); }
      finally { await client.query('ROLLBACK TO SAVEPOINT constraint_check'); }
    }
    await fails("INSERT INTO diagnostic_sessions(id,user_id) VALUES ($1,'alice')", [randomUUID()], '23505');
    await fails("INSERT INTO diagnostic_sessions(id,user_id,kind,parent_session_id) VALUES ($1,'bob','confirmation',$2)", [randomUUID(), initialId], '23503');
    await fails("INSERT INTO diagnostic_sessions(id,user_id,kind,parent_session_id) VALUES ($1,'alice','confirmation',$2)", [randomUUID(), initialId], '23505');
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
});
