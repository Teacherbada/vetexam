import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import pg from 'pg';
import nextEnv from '@next/env';

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === 'server-only') return {};
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:')) return require(name);
    throw new Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
const input = load('lib/admin-question-input.ts');
const service = load('lib/admin-questions.ts', { './admin-question-input': input });
const q = (id, number = id, answer = '') => ({ id, question_set_id: 1, question_number: number, subject: '科目', question: '題目', option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', option_e: null, answer, explanation: '' });
const parse = (mode, text, questions = [q(1), q(2), q(3), q(4)]) => input.parseEntries(input.parseInput({ question_set_id: 1, mode, text }), questions);

test('paste supports spaces, tabs, dot, ideographic comma, colon and lowercase; rejects partial and duplicate lines', () => {
  for (const delimiter of [' ', '\t', '.', '、', ':', ' : ']) {
    const result = parse('table', `1${delimiter}a\r\n2${delimiter}C\n3${delimiter}B\n`);
    assert.deepEqual(result.entries.map(e => e.answer), ['A', 'C', 'B']); assert.deepEqual(result.errors, []);
  }
  for (const text of ['1 Z', '1 ABC', '1 <script>', '1 1', '1A', '1 A extra', '1 A\n1 B']) assert(parse('table', text).errors.length > 0);
  for (const answer of ['E', '1', 'ABC', '<script>']) assert.throws(() => input.parseInput({ question_set_id: 1, mode: 'keyboard', answers: [{ question_number: 1, answer }] }));
  assert.throws(() => input.parseInput({ mode: 'table', text: '1 A' }));
  assert.throws(() => input.parseInput({ question_set_id: 1, mode: 'single', question_id: 1, answer: 'C', isAdmin: true }));
});
test('continuous strings require exact length AND sequential unique numbers', () => {
  assert.deepEqual(parse('sequence', 'a c\nb d').entries.map(e => e.answer), ['A', 'C', 'B', 'D']);
  assert(parse('sequence', 'A'.repeat(79), Array.from({ length: 80 }, (_, i) => q(i + 1))).errors.length);
  assert(parse('sequence', 'ACBD', [q(1), q(2, 2), q(3, 2), q(4)]).errors.length);
  assert(parse('sequence', 'ACBD', [q(1), q(2), q(3), q(4, 5)]).errors.length);
});
test('preview distinguishes missing/same/changed, warns stats, skips special cases and rejects ambiguous numbers', async () => {
  const questions = [q(1, 1, null), q(2, 2, ' c '), q(3, 3, 'B'), q(4, 4, 'AC'), { ...q(5), option_e: 'e' }, q(6, 6), q(7, 6)];
  const query = async sql => sql.includes('SELECT id FROM question_sets') ? [{ id: 1 }] : sql.includes('FROM question_answer_stats') ? [{ question_id: 3, recalculate: 83, remove: 43 }] : questions;
  const payload = input.parseInput({ question_set_id: 1, mode: 'table', text: '1 C\n2 C\n3 C\n4 C\n5 C\n6 C\n99 D' });
  const preview = await service.buildPreview(query, payload);
  assert.deepEqual(preview.rows.map(r => r.status), ['added', 'same', 'changed', 'skipped', 'skipped', 'unmatched', 'unmatched']);
  assert.equal(preview.summary.recalculate, 83); assert.equal(preview.summary.remove, 43); assert.equal(preview.can_apply, false);
  const single = await service.buildPreview(query, input.parseInput({ question_set_id: 1, mode: 'single', question_id: 7, answer: 'D' }));
  assert.equal(single.rows[0].question_id, 7); assert.equal(single.can_apply, true);
});
test('preview tokens are bound to user, snapshot, expiry and signature', () => {
  const previous = process.env.BETTER_AUTH_SECRET;
  process.env.BETTER_AUTH_SECRET = 'test-secret-only';
  try {
    const token = service.issuePreviewToken('snapshot', 'admin');
    assert.equal(service.checkPreviewToken(token, 'snapshot', 'admin'), true);
    assert.equal(service.checkPreviewToken(token, 'stale', 'admin'), false);
    assert.equal(service.checkPreviewToken(token, 'snapshot', 'other'), false);
    assert.equal(service.checkPreviewToken(token + 'x', 'snapshot', 'admin'), false);
    const now = Date.now; Date.now = () => now() + 16 * 60 * 1000;
    try { assert.equal(service.checkPreviewToken(token, 'snapshot', 'admin'), false); } finally { Date.now = now; }
  } finally { if (previous === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = previous; }
});
test('every admin operation denies guests/non-admin before parsing or accessing DB; rejects forged flags and cross-origin', async () => {
  let allowed = false, queries = 0;
  const http = load('lib/admin-question-http.ts', { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, './admin-questions': service });
  const mocks = {
    '@/lib/admin': { requireAdmin: async () => allowed ? { session: { user: { id: 'admin' } }, sql: { query: async () => { queries++; return []; } } } : null },
    '@/lib/admin-question-input': input, '@/lib/admin-questions': service, '@/lib/admin-question-http': http,
    '@/lib/question-transaction': { questionTransaction: async () => { queries++; throw new Error('Unexpected database access'); } },
  };
  const write = load('app/api/admin/questions/bulk-answers/route.ts', mocks);
  const read = load('app/api/admin/questions/route.ts', mocks);
  const request = (body, origin = 'https://vetexam.test') => new Request('https://vetexam.test/api/admin/questions/bulk-answers', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
  for (const mode of ['single', 'keyboard', 'table', 'sequence']) for (const action of ['preview', 'apply']) assert.equal((await write.POST(request({ action, input: { mode }, isAdmin: true }))).status, 403);
  assert.equal((await read.GET(new Request('https://vetexam.test/api/admin/questions'))).status, 403);
  assert.equal(queries, 0); allowed = true;
  assert.equal((await write.POST(request({}, 'https://evil.test'))).status, 403);
  assert.equal((await write.POST(request({ action: 'preview', input: { question_set_id: 1, mode: 'keyboard', answers: [{ question_number: 1, answer: 'Z' }] } }))).status, 400);
  assert.equal((await write.POST(request({ padding: 'x'.repeat(65537) }))).status, 413);
  assert.equal(queries, 0);
});
test('transaction commits only on success and rolls back/release on failure', async () => {
  const statements = [];
  const client = { query: async sql => { statements.push(sql); }, release: () => statements.push('RELEASE') };
  const tx = load('lib/question-transaction.ts', { pg: { Pool: class { async connect() { return client; } } } });
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'fixture';
  try {
    await assert.rejects(tx.questionTransaction(async () => { throw new Error('injected failure'); }));
    assert.equal(statements.includes('COMMIT'), false); assert.deepEqual(statements.slice(-2), ['ROLLBACK', 'RELEASE']);
    statements.length = 0; await tx.questionTransaction(async () => 'ok'); assert.deepEqual(statements.slice(-2), ['COMMIT', 'RELEASE']);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
test('existing ADMIN_USER_ID and page guard reject non-admin, including missing configuration', async () => {
  let userId = null;
  const auth = { auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } } };
  const guard = load('lib/admin.ts', { '@/lib/auth': auth, '@neondatabase/serverless': { neon: () => ({}) } });
  const pageGuard = load('lib/admin-page.ts', { '@/lib/auth': auth, 'next/headers': { headers: async () => new Headers() }, 'next/navigation': { redirect: path => { throw new Error('redirect:' + path); } } });
  const previousId = process.env.ADMIN_USER_ID, previousDb = process.env.DATABASE_URL;
  process.env.ADMIN_USER_ID = ' admin '; process.env.DATABASE_URL = 'fixture';
  try {
    const request = new Request('https://vetexam.test');
    assert.equal(await guard.requireAdmin(request), null); await assert.rejects(pageGuard.requireAdminPage(), /redirect:\/login/);
    userId = 'ordinary-user'; assert.equal(await guard.requireAdmin(request), null); await assert.rejects(pageGuard.requireAdminPage(), /redirect:\//);
    userId = 'admin'; assert(await guard.requireAdmin(request)); await pageGuard.requireAdminPage();
    delete process.env.ADMIN_USER_ID; assert.equal(await guard.requireAdmin(request), null); await assert.rejects(pageGuard.requireAdminPage(), /redirect:\//);
  } finally {
    if (previousId === undefined) delete process.env.ADMIN_USER_ID; else process.env.ADMIN_USER_ID = previousId;
    if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb;
  }
});
test('missing/blank/invalid answer is not gradable, valid lowercase is normalized', () => {
  const { usableAnswer } = load('lib/question-answer.ts');
  for (const answer of [null, '', ' ', 'AC', 'E']) assert.equal(usableAnswer({ answer, options: ['a', 'b', 'c', 'd'] }), null);
  assert.equal(usableAnswer({ answer: ' c ', options: ['a', 'b', 'c', 'd'] }), 'C');
});

test('PostgreSQL: set isolation, single ID, atomic stats correction/removal, stale preview, rollback and missing-answer exclusion', { skip: process.env.ADMIN_QUESTIONS_DB_TEST !== '1' }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const schema = 'admin_questions_test_' + randomUUID().replaceAll('-', '');
  try {
    await client.query('BEGIN'); await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET LOCAL search_path TO ${schema},public`);
    await client.query("CREATE TABLE question_sets (id integer PRIMARY KEY,visibility text,exam_year integer,name text DEFAULT 'fixture',exam_subject text DEFAULT 'subject')");
    await client.query("CREATE TABLE questions (id integer PRIMARY KEY,question_set_id integer,question_number integer,subject text DEFAULT 'subject',question text DEFAULT 'question',answer text,option_a text DEFAULT 'a',option_b text DEFAULT 'b',option_c text DEFAULT 'c',option_d text DEFAULT 'd',option_e text,explanation text DEFAULT '')");
    await client.query('CREATE TABLE question_answer_stats (id serial PRIMARY KEY,user_id text,question_id integer,is_correct boolean,selected_answer text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(user_id,question_id))');
    await client.query("INSERT INTO question_sets(id,visibility,exam_year) VALUES (1,'public',2026),(2,'public',2026)");
    await client.query("INSERT INTO questions(id,question_set_id,question_number,answer) VALUES (1,1,1,NULL),(2,1,2,'C'),(3,1,3,'B'),(4,1,4,''),(5,2,1,'B'),(6,2,2,'A'),(7,2,3,'A')");
    await client.query("INSERT INTO question_answer_stats(user_id,question_id,is_correct,selected_answer) VALUES ('u1',3,true,'B'),('u2',3,false,'C'),('legacy',3,true,NULL),('bad-init',1,false,'C')");
    const query = async (sql, values) => (await client.query(sql, values)).rows;
    const http = load('lib/admin-question-http.ts', { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, './admin-questions': service });
    const read = load('app/api/admin/questions/route.ts', {
      '@/lib/admin': { requireAdmin: async () => ({ sql: { query } }) },
      '@/lib/admin-question-http': http, '@/lib/admin-questions': service,
    });
    const listing = await read.GET(new Request('https://vetexam.test/api/admin/questions?question_set_id=1&quality=missing_answer&year=2026&subject=subject&keyword=quest'));
    assert.equal(listing.status, 200);
    const list = await listing.json(); assert.equal(list.summary.total, 7); assert.equal(list.total, 2); assert.deepEqual(list.questions.map(q => q.id), [1, 4]);
    const editor = await (await read.GET(new Request('https://vetexam.test/api/admin/questions?question_set_id=1&editor=1'))).json(); assert.equal(editor.questions.length, 4);
    const payload = input.parseInput({ question_set_id: 1, mode: 'table', text: '1 C\n2 C\n3 C' });
    let preview = await service.buildPreview(query, payload);
    assert.deepEqual(preview.summary, { added: 1, same: 1, changed: 1, skipped: 0, unmatched: 0, recalculate: 3, remove: 1 });
    const token = service.issuePreviewToken(preview.fingerprint, 'admin');
    await assert.rejects(service.applyAnswers(client, payload, token, 'admin', false, false), /確認統計/);
    await assert.rejects(service.applyAnswers(client, payload, token, 'admin', true, false), /確認清除/);
    // Inject a DB error after the question UPDATE, then roll back the savepoint.
    await client.query('SAVEPOINT failure_case');
    const broken = { query: async (sql, values) => {
      if (sql.startsWith('UPDATE question_answer_stats')) return client.query('SELECT 1/0');
      return client.query(sql, values);
    } };
    await assert.rejects(service.applyAnswers(broken, payload, token, 'admin', true, true));
    await client.query('ROLLBACK TO SAVEPOINT failure_case');
    assert.equal((await query('SELECT answer FROM questions WHERE id=3', []))[0].answer, 'B');
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM question_answer_stats', []))[0].n, 4);
    await service.applyAnswers(client, payload, token, 'admin', true, true);
    assert.deepEqual((await query('SELECT answer FROM questions WHERE question_set_id=2 ORDER BY id', [])).map(q => q.answer), ['B', 'A', 'A']);
    assert.deepEqual((await query('SELECT selected_answer,is_correct FROM question_answer_stats WHERE question_id=3 ORDER BY id', [])), [{ selected_answer: 'B', is_correct: false }, { selected_answer: 'C', is_correct: true }]);
    assert.equal((await query('SELECT is_correct FROM question_answer_stats WHERE question_id=1', []))[0].is_correct, true);
    const unchanged = await service.buildPreview(query, payload); assert.equal(unchanged.can_apply, false);
    // A fresh attempt changes confirmation counts and invalidates an existing preview.
    const correction = input.parseInput({ question_set_id: 1, mode: 'single', question_id: 3, answer: 'D' });
    preview = await service.buildPreview(query, correction);
    await client.query("INSERT INTO question_answer_stats(user_id,question_id,is_correct,selected_answer) VALUES ('new-user',3,true,'C')");
    await assert.rejects(service.applyAnswers(client, correction, service.issuePreviewToken(preview.fingerprint, 'admin'), 'admin', true, true), /重新解析預覽/);
    const stats = load('lib/question-stats.ts');
    await stats.recordFirstAnswers(query, 'missing-answer', [{ question_id: 4, selected_answer: 'A' }]);
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM question_answer_stats WHERE question_id=4', []))[0].n, 0);
    // Duplicate number can still be edited by a unique question ID in the selected set.
    await client.query('UPDATE questions SET question_number=1 WHERE id=2');
    const one = input.parseInput({ question_set_id: 1, mode: 'single', question_id: 2, answer: 'D' });
    preview = await service.buildPreview(query, one);
    await service.applyAnswers(client, one, service.issuePreviewToken(preview.fingerprint, 'admin'), 'admin', true, true);
    assert.equal((await query('SELECT answer FROM questions WHERE id=1', []))[0].answer, 'C');
    assert.equal((await query('SELECT answer FROM questions WHERE id=2', []))[0].answer, 'D');
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
