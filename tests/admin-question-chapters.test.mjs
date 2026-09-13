import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import nextEnv from '@next/env';
import pg from 'pg';

function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === 'server-only') return {};
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
class QuestionAdminError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const taxonomy = load('data/exam-chapters.ts');
const service = load('lib/admin-question-chapters.ts', { '../data/exam-chapters': taxonomy, './admin-questions': { QuestionAdminError } });
const http = load('lib/admin-question-http.ts', { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, './admin-questions': { QuestionAdminError } });
const path = 'https://test.local/api/admin/questions/chapters';
const input = { questionId: 1, chapter: '腫瘤', previousChapter: null };

test('actual ADMIN_USER_ID guard rejects guests, members and forged roles before chapter reads/writes', async () => {
  const old = { admin: process.env.ADMIN_USER_ID, db: process.env.DATABASE_URL };
  process.env.ADMIN_USER_ID = 'real-admin'; process.env.DATABASE_URL = 'fixture';
  let session = null, reads = 0, writes = 0;
  const guard = load('lib/admin.ts', { '@neondatabase/serverless': { neon: () => ({ query: async () => { reads++; return []; } }) }, '@/lib/auth': { auth: { api: { getSession: async () => session } } } });
  const route = load('app/api/admin/questions/chapters/route.ts', { '@/lib/admin': guard, '@/lib/admin-question-http': http,
    '@/lib/admin-question-chapters': { readChapterQueue: async () => { reads++; return {}; }, updateQuestionChapter: async (_client, body) => { writes++; return body; } },
    '@/lib/question-transaction': { questionTransaction: fn => fn({}) } });
  const patch = (body = input, origin = 'https://test.local') => new Request(path, { method: 'PATCH', headers: { origin, 'content-type': 'application/json', 'x-user-id': 'real-admin', 'x-role': 'admin' }, body: JSON.stringify(body) });
  try {
    for (const user of [null, { user: { id: 'member', role: 'admin' } }]) {
      session = user;
      assert.equal((await route.GET(new Request(path + '?subject=獸醫病理學&userId=real-admin'))).status, 403);
      assert.equal((await route.PATCH(patch())).status, 403);
    }
    assert.equal(reads + writes, 0);
    session = { user: { id: 'real-admin' } };
    assert.equal((await route.GET(new Request(path + '?subject=獸醫病理學'))).status, 200);
    assert.equal((await route.PATCH(patch(input, 'https://evil.test'))).status, 403);
    const response = await route.PATCH(patch());
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(writes, 1);
    process.env.ADMIN_USER_ID = '';
    assert.equal((await route.PATCH(patch())).status, 403);
  } finally {
    for (const [key, value] of [['ADMIN_USER_ID', old.admin], ['DATABASE_URL', old.db]]) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('chapter write validates DB subject, allows only chapter payload and detects stale rows', async () => {
  const queries = [];
  let row = { subject: '獸醫病理學', chapter: null };
  const client = { query: async (text, values) => { queries.push({ text, values }); return { rows: row ? [row] : [] }; } };
  for (const body of [{ ...input, subject: '獸醫藥理學' }, { ...input, answer: 'A' }, { ...input, questionId: '1' }, { ...input, questionId: 0 }, { ...input, chapter: '' }, { ...input, chapter: null }, { ...input, chapter: [] }, { questionId: 1, chapter: '腫瘤' }]) await assert.rejects(service.updateQuestionChapter(client, body));
  assert.equal(queries.length, 0);
  await assert.rejects(service.updateQuestionChapter(client, { ...input, chapter: '血液學' }));
  await service.updateQuestionChapter(client, input);
  assert.equal(queries.at(-1).text, 'UPDATE questions SET chapter=$1 WHERE id=$2');
  assert.deepEqual(queries.at(-1).values, ['腫瘤', 1]);
  row.chapter = '腫瘤';
  await assert.rejects(service.updateQuestionChapter(client, input), e => e.status === 409);
  await service.updateQuestionChapter(client, { ...input, chapter: '造血及淋巴系統', previousChapter: '腫瘤' });
  row = null;
  await assert.rejects(service.updateQuestionChapter(client, input), e => e.status === 404);
  for (const params of ['subject=bad', 'subject=獸醫病理學&status=bad', 'subject=獸醫病理學&after=-1', 'subject=獸醫病理學&question_set_id=1 OR TRUE']) await assert.rejects(service.readChapterQueue(() => { throw Error('must not query'); }, new URLSearchParams(params)), QuestionAdminError);
});

test('PostgreSQL: only chapter changes; all/NULL/classified queues and existing quiz update together', { skip: process.env.ADMIN_CHAPTER_DB_TEST !== '1' }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query('CREATE TEMP TABLE questions (LIKE public.questions INCLUDING DEFAULTS)');
    await client.query('CREATE TEMP TABLE question_sets (LIKE public.question_sets INCLUDING DEFAULTS)');
    await client.query("INSERT INTO pg_temp.question_sets(id,name,total_questions,visibility) VALUES (1,'fixture',3,'public'),(2,'private',1,'private')");
    await client.query("INSERT INTO pg_temp.questions(id,question_set_id,question_number,subject,question,option_a,option_b,option_c,option_d,answer,explanation,chapter) VALUES (1,1,1,'獸醫病理學','題幹','a','b','c','d','B','解析',NULL),(2,1,2,'獸醫病理學','題幹二','a','b','c','d','C','解析二',NULL),(3,1,3,'獸醫藥理學','藥理','a','b','c','d','A','解析三',NULL),(4,2,1,'獸醫病理學','私人題','a','b','c','d','A','私人解析',NULL)");
    const query = async (text, values) => (await client.query(text, values)).rows;
    const read = params => service.readChapterQueue(query, new URLSearchParams({ subject: '獸醫病理學', ...params }));
    const snapshot = () => query("SELECT to_jsonb(q)-'chapter' AS row FROM pg_temp.questions q ORDER BY id", []);
    const before = await snapshot();
    assert.deepEqual((await read({})).progress, { total: 3, classified: 0, unclassified: 3 });
    await service.updateQuestionChapter(client, input);
    assert.equal((await read({})).question.id, 2);
    assert.equal((await read({ status: 'classified' })).question.id, 1);
    assert.equal((await read({ status: 'all', after: '1' })).question.id, 2);
    assert.deepEqual((await read({ question_set_id: '1' })).progress, { total: 2, classified: 1, unclassified: 1 });
    assert.equal((await read({ after: '4' })).question, null);

    // Use the real Neon SQL-template compiler while redirecting execution to the temporary tables.
    const { neon, neonConfig } = await import('@neondatabase/serverless');
    const originalFetch = neonConfig.fetchFunction;
    neonConfig.fetchFunction = async (_url, options) => {
      const body = JSON.parse(options.body);
      const result = await client.query({ text: body.query, values: body.params, rowMode: 'array' });
      return Response.json({ fields: result.fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })), rows: result.rows.map(row => row.map(v => v === null ? null : String(v))), command: result.command, rowCount: result.rowCount });
    };
    const sql = neon('postgresql://fixture:fixture@fixture.invalid/fixture');
    const quiz = load('app/api/quiz/route.ts', { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, '@neondatabase/serverless': { neon: () => sql }, '@/lib/auth': { auth: { api: { getSession: async () => null } } }, '@/data/exam-chapters': taxonomy });
    const runQuiz = async params => { const response = await quiz.GET(new Request('https://test.local/api/quiz?' + new URLSearchParams({ scope: 'public', ...params }))); assert.equal(response.status, 200); return response.json(); };
    const groups = chapter => JSON.stringify([{ subject: '獸醫病理學', years: [], count: 'all', ...(chapter ? { chapter } : {}) }]);
    try {
    const availability = await runQuiz({ settings: '1', chapters: '1' });
    assert.equal(availability.chapterAvailability.find(r => r.chapter === '腫瘤').count, 1);
    assert.deepEqual((await runQuiz({ groups: groups('腫瘤') })).questions.map(q => q.id), [1]);
    assert.deepEqual((await runQuiz({ groups: groups() })).questions.map(q => q.id), [1, 2]);
    await service.updateQuestionChapter(client, { ...input, chapter: '造血及淋巴系統', previousChapter: '腫瘤' });
    assert.equal((await runQuiz({ groups: groups('腫瘤') })).questions.length, 0);
    assert.deepEqual((await runQuiz({ groups: groups('造血及淋巴系統') })).questions.map(q => q.id), [1]);
    } finally { neonConfig.fetchFunction = originalFetch; }
    assert.deepEqual(await snapshot(), before);
    assert.equal((await query('SELECT chapter FROM pg_temp.questions WHERE id=2', []))[0].chapter, null);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
