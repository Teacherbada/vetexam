import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import nextEnv from '@next/env';
import pg from 'pg';

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
const rules = load('lib/diagnostic.ts', { '../data/exam-chapters': chapters });
const stats = load('lib/question-stats.ts');
const service = load('lib/diagnostic-service.ts', {
  'node:crypto': { randomUUID }, '@/data/exam-chapters': chapters, '@/lib/diagnostic': rules,
  '@/lib/question-answer': load('lib/question-answer.ts'), '@/lib/question-stats': stats,
});
const subjects = chapters.EXAM_SUBJECTS;

test('balanced 60 unique questions use official subjects and diverse available chapters', () => {
  let id = 0;
  const candidates = subjects.flatMap(subject => Array.from({ length: 30 }, (_, index) => ({ id: ++id, subject,
    chapter: chapters.chapterGroups(subject).flatMap(group => group.chapters)[index % chapters.chapterGroups(subject).flatMap(group => group.chapters).length], last_answered: null })));
  const selected = rules.selectDiagnosticQuestions([...candidates, candidates[0]], Date.now(), () => 0.5);
  assert.equal(selected.length, 60);
  assert.equal(new Set(selected.map(row => row.id)).size, 60);
  for (const subject of subjects) assert.equal(selected.filter(row => row.subject === subject).length, 10);
  assert.equal(new Set(selected.filter(row => row.subject === subjects[0]).map(row => row.chapter)).size, 10);
  assert.deepEqual(selected.slice(0, 6).map(row => row.subject), subjects);
});
test('unseen first, older history before recent, and shortage fallback does not duplicate', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, subject: subjects[0], chapter: null,
    last_answered: index < 4 ? null : index < 8 ? '2025-01-01' : '2026-09-13' }));
  const selected = rules.selectDiagnosticQuestions(rows, Date.parse('2026-09-14'), () => 0.5);
  assert.deepEqual(selected.slice(0, 8).map(row => row.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(rules.selectDiagnosticQuestions(rows.slice(0, 3)).length, 3);
  assert.deepEqual(rules.selectDiagnosticQuestions([]), []);
});
test('missing and small-sample subjects are never weak; incomplete results are not ranked', () => {
  const rows = subjects.flatMap((subject, index) => Array.from({ length: index === 0 ? 1 : 10 }, () => ({ subject, selected_answer: 'A', is_correct: false })));
  const summary = rules.summarizeDiagnostic(rows);
  assert.equal(summary[0].insufficient, true); assert.equal(summary[0].suspect, false);
  assert.equal(summary.filter(row => row.suspect).length, 2);
  assert.equal(rules.summarizeDiagnostic([...rows, { subject: subjects[0], selected_answer: null, is_correct: null }]).some(row => row.suspect), false);
  assert(rules.summarizeDiagnostic([]).every(row => row.insufficient && !row.suspect));
});
test('answer validation rejects user identity, correctness and invalid choices/positions', () => {
  const valid = { sessionId: randomUUID(), position: 1, answer: 'A' };
  assert.deepEqual(rules.parseDiagnosticAnswer(valid), valid);
  for (const value of [{ ...valid, userId: 'victim' }, { ...valid, correct: true }, { ...valid, answer: 'F' }, { ...valid, position: 61 }, { ...valid, sessionId: 'not-a-uuid' }, null]) assert.equal(rules.parseDiagnosticAnswer(value), null);
});

function route(userId, execute = async () => { throw new Error('storage secret'); }) {
  return load('app/api/study-plan/diagnostic/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } } },
    '@/lib/question-transaction': { questionTransaction: execute },
    '@/lib/diagnostic-service': service, '@/lib/diagnostic': rules,
  });
}
const url = 'https://test.local/api/study-plan/diagnostic';
test('API protects identity, origin, request size and error details', async () => {
  const guest = route(null);
  assert.equal((await guest.GET(new Request(url))).status, 401);
  assert.equal((await guest.POST(new Request(url, { method: 'POST' }))).status, 401);
  const api = route('alice');
  assert.equal((await api.POST(new Request(url, { method: 'POST', headers: { origin: 'https://evil.local' } }))).status, 403);
  for (const [body, status] of [['{', 400], ['x'.repeat(1025), 413], [JSON.stringify({ sessionId: randomUUID(), position: 1, answer: 'A', userId: 'bob' }), 400]]) {
    assert.equal((await api.PUT(new Request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }))).status, status);
  }
  const failure = await api.GET(new Request(url));
  assert.equal(failure.status, 503); assert.doesNotMatch(await failure.text(), /storage secret/);
  assert.equal(failure.headers.get('cache-control'), 'private, no-store');
});

test('PostgreSQL: create, persist, replay, account isolation, snapshots, completion and fallback', { skip: process.env.DIAGNOSTIC_DB_TEST !== '1', timeout: 240000 }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '20s'");
    // All fixtures shadow public tables in this connection and disappear on rollback.
    await client.query(`CREATE TEMP TABLE study_plans (user_id text PRIMARY KEY, mode text);
      CREATE TEMP TABLE question_sets (id integer PRIMARY KEY, visibility text);
      CREATE TEMP TABLE questions (id integer PRIMARY KEY, question_set_id integer, subject text, chapter text, question text, answer text,
        option_a text, option_b text, option_c text, option_d text, option_e text, image_data_url text);
      CREATE TEMP TABLE question_answer_stats (id bigserial, user_id text, question_id integer, is_correct boolean, selected_answer text,
        created_at timestamptz DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, question_id));
      INSERT INTO study_plans VALUES ('alice','coach'), ('bob','coach'), ('custom','custom'), ('empty','coach');
      INSERT INTO question_sets VALUES (1,'public'), (2,'private');`);
    const migration = readFileSync(new URL('../migrations/20260914_initial_diagnostic.sql', import.meta.url), 'utf8').replaceAll('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE IF NOT EXISTS');
    await client.query(migration); await client.query(migration);
    await client.query(readFileSync(new URL('../migrations/20260915_diagnostic_confirmation.sql', import.meta.url), 'utf8'));
    const fixtures = subjects.flatMap((subject, index) => Array.from({ length: 12 }, (_, n) => ({ id: index * 100 + n + 1, subject })));
    await client.query(`INSERT INTO questions (id, question_set_id, subject, question, answer, option_a, option_b, option_e)
      SELECT id, 1, subject, 'Fixture question', 'E', 'Option A', 'Option B', 'Option E'
      FROM jsonb_to_recordset($1::jsonb) AS r(id integer, subject text)`, [JSON.stringify(fixtures)]);
    await client.query("INSERT INTO questions VALUES (9999,2,$1,NULL,'Private','A','A','B',NULL,NULL,NULL,NULL), (9998,1,$1,NULL,'No answer',NULL,'A','B',NULL,NULL,NULL,NULL)", [subjects[0]]);
    assert.equal((await service.readDiagnostic(client, 'alice')).session, null);
    await assert.rejects(service.startDiagnostic(client, 'custom'), error => error.status === 409);
    let view = await service.startDiagnostic(client, 'alice');
    assert.equal(view.session.total, 60);
    assert.deepEqual(view.session.shortages, []);
    assert.doesNotMatch(JSON.stringify(view), /answer_key|selected_answer|is_correct|Private/);
    const id = view.session.id;
    assert.equal((await service.startDiagnostic(client, 'alice')).session.id, id);
    assert.equal((await service.readDiagnostic(client, 'bob')).session, null);
    await assert.rejects(service.answerDiagnostic(client, 'bob', { sessionId: id, position: 1, answer: 'E' }), error => error.status === 404);
    await assert.rejects(service.answerDiagnostic(client, 'alice', { sessionId: id, position: 2, answer: 'E' }), error => error.status === 409);
    await assert.rejects(service.answerDiagnostic(client, 'alice', { sessionId: id, position: 1, answer: 'C' }), error => error.status === 400);
    view = await service.answerDiagnostic(client, 'alice', { sessionId: id, position: 1, answer: 'E' });
    assert.equal(view.session.answered, 1);
    // Simulate the end of one API transaction and a later resume request.
    // Only connection-local TEMP tables have been written; no public rows exist.
    await client.query('COMMIT');
    await client.query('BEGIN');
    assert.equal((await service.readDiagnostic(client, 'alice')).session.current.position, 2);
    assert.equal((await service.answerDiagnostic(client, 'alice', { sessionId: id, position: 1, answer: 'E' })).session.answered, 1);
    await assert.rejects(service.answerDiagnostic(client, 'alice', { sessionId: id, position: 1, answer: 'A' }), error => error.status === 409);
    await client.query("UPDATE study_plans SET mode='custom' WHERE user_id='alice'");
    await assert.rejects(service.answerDiagnostic(client, 'alice', { sessionId: id, position: 2, answer: 'E' }), error => error.status === 409);
    await client.query("UPDATE study_plans SET mode='coach' WHERE user_id='alice'");
    view = await service.readDiagnostic(client, 'alice');
    assert.equal(view.session.current.position, 2);
    // Later source edits/deletion cannot erase or regrade the diagnostic snapshot.
    await client.query("UPDATE questions SET answer='A', question='Edited later' WHERE id=$1", [view.session.current.questionId]);
    await client.query('DELETE FROM questions WHERE id=$1', [view.session.current.questionId]);
    for (let position = 2; position <= 60; position++) {
      view = await service.answerDiagnostic(client, 'alice', { sessionId: id, position, answer: 'E' });
    }
    assert.equal(view.session.completed, true); assert.equal(view.session.current, null);
    assert(view.session.results.every(row => row.correct === 10 && !row.suspect));
    assert.equal((await service.startDiagnostic(client, 'alice')).session.id, id);
    const saved = await client.query('SELECT COUNT(*)::int AS n FROM diagnostic_items WHERE session_id=$1 AND answered_at IS NOT NULL', [id]);
    assert.equal(saved.rows[0].n, 60);
    await client.query('DELETE FROM questions WHERE id <> 1');
    const partial = await service.startDiagnostic(client, 'bob');
    assert.equal(partial.session.total, 1); assert.equal(partial.session.shortages.length, 6);
    await client.query('DELETE FROM questions');
    await assert.rejects(service.startDiagnostic(client, 'empty'), error => error.status === 409);
  } finally { await client.query('ROLLBACK').catch(() => {}); await client.end(); }
});
