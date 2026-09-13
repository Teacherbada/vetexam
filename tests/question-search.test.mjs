import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import nextEnv from '@next/env';
import pg from 'pg';
function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === 'server-only') return {};
    if (name in mocks) return mocks[name];
    throw new Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
const search = load('lib/question-search.ts');
const stats = load('lib/question-stats.ts');
const detail = load('lib/question-detail-answer.ts', { './question-answer': load('lib/question-answer.ts'), './question-stats': stats });

test('search parses bounded filters and roundtrips URL state; literal wildcard escaping', () => {
  const f = search.parseSearch({ q: ' Addison%_\\ ', subject: search.SEARCH_SUBJECTS[0], year: '115', number: '37', set: '2', page: '2' });
  assert.equal(f.page, 2); assert.equal(f.invalid, false);
  const query = search.searchQuery(f);
  assert.equal(query.values[0], '%Addison\\%\\_\\\\%');
  assert.equal(query.values[3], 2026); assert.equal(query.values[6], 21); assert.equal(query.values[7], 20);
  assert.equal(search.searchQuery(search.parseSearch({ year: '2026' })).values[3], 115);
  assert.equal(new URL(search.searchUrl(f, 3), 'https://example.com').searchParams.get('q'), f.q);
  for (const params of [{ subject: 'invalid' }, { year: 'x' }, { number: '-1' }, { set: '2147483648' }]) assert(search.parseSearch(params).invalid);
  assert.equal(search.parseSearch({}).active, false);
  assert.equal(search.parseSearch({ q: 'x'.repeat(400), page: '9999999' }).q.length, 200);
  assert.equal(search.parseSearch({ page: '9999999' }).page, 1);
});

test('initial public projection strips extra sensitive fields, private/malformed IDs do not leak', async () => {
  let reads = 0;
  const query = async () => { reads++; return [{ id: 1, question_set_id: 1, question_number: 1, question: 'stem', option_a: 'a', has_answer: true, answer: 'SECRET', explanation: 'PRIVATE EXPLANATION' }]; };
  query.query = query;
  const publicQuestions = load('lib/public-questions.ts', { react: { cache: fn => fn }, '@neondatabase/serverless': { neon: () => query }, './question-search': search });
  const old = process.env.DATABASE_URL; process.env.DATABASE_URL = 'fixture';
  try {
    assert.equal(await publicQuestions.getPublicQuestion('nope'), null);
    assert.equal(await publicQuestions.getPublicQuestion('2147483648'), null); assert.equal(reads, 0);
    const question = await publicQuestions.getPublicQuestion('1');
    assert(!JSON.stringify(question).includes('SECRET')); assert(!('answer' in question)); assert(!('explanation' in question));
    await publicQuestions.searchPublicQuestions(search.parseSearch({})); assert.equal(reads, 1);
  } finally { if (old === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = old; }
});

test('reveal API guests, session users, missing IDs, invalid body, origin and no-store', async () => {
  let user = null, calls = 0;
  const route = load('app/api/stats/answers/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { auth: { api: { getSession: async () => user && { user: { id: user } } } } },
    '@/lib/question-stats': stats,
    '@/lib/question-transaction': { questionTransaction: fn => fn({}) },
    '@/lib/question-detail-answer': { answerPublicQuestion: async (_client, id, submission) => { calls++; assert.equal(id, user); return { status: submission.question_id === 99 ? 404 : 200, body: { available: true, answer: 'C' } }; } },
  });
  const request = (answers, origin = 'https://test.local') => new Request('https://test.local/api/stats/answers?reveal=1', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ answers }) });
  const input = [{ question_id: 1, selected_answer: 'B' }];
  let response = await route.POST(request(input)); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  user = 'session-user'; response = await route.POST(request(input)); assert.equal(response.status, 200); assert.equal(calls, 2);
  assert.equal((await route.POST(request(input, 'https://evil.test'))).status, 403);
  assert.equal((await route.POST(request([...input, { question_id: 2, selected_answer: 'A' }]))).status, 400);
  assert.equal((await route.POST(request([{ question_id: 99, selected_answer: 'A' }]))).status, 404);
});

test('PostgreSQL: bilingual option search, filters, paging, privacy, answer reveal and first-answer deduplication', { skip: process.env.SEARCH_DB_TEST !== '1' }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    const schema = 'search_test_' + randomUUID().replaceAll('-', '');
    await client.query('CREATE SCHEMA ' + schema);
    await client.query('SET LOCAL search_path TO ' + schema + ',public');
    await client.query("CREATE TABLE question_sets(id integer PRIMARY KEY, visibility text, exam_year integer)");
    await client.query("CREATE TABLE questions(id integer PRIMARY KEY, question_set_id integer, question_number integer, subject text, question text, option_a text, option_b text, option_c text, option_d text, option_e text, answer text, explanation text)");
    await client.query('CREATE TABLE question_answer_stats(id serial PRIMARY KEY, user_id text, question_id integer, is_correct boolean, selected_answer text, UNIQUE(user_id,question_id))');
    await client.query("INSERT INTO question_sets VALUES(1,'public',2026),(2,'private',2026),(3,'public',114)");
    await client.query("INSERT INTO questions SELECT i,1,i,'獸醫病理學','腎上腺題目 '||i,'Addison disease','b','c','d',NULL,'C','official explanation' FROM generate_series(1,25) i");
    await client.query("INSERT INTO questions VALUES(26,2,26,'獸醫病理學','private-secret','Addison','b','c','d',NULL,'B','private-explanation'),(27,3,27,'獸醫藥理學','other year','a','b','c','d',NULL,NULL,NULL)");
    const find = async params => { const q = search.searchQuery(search.parseSearch(params)); return (await client.query(q.text,q.values)).rows; };
    for (const q of ['addison','ADDISON','腎上腺']) { const rows = await find({ q }); assert.equal(rows.length,21); assert(!JSON.stringify(rows).includes('answer')); assert(!JSON.stringify(rows).includes('private-secret')); }
    assert.equal((await find({ q: 'Addison', page:'2' })).length,5);
    assert.equal((await find({ year:'115', number:'3' }))[0].id,3);
    assert.equal((await find({ subject:'獸醫藥理學' }))[0].id,27);
    assert.equal((await find({ q:'%' })).length,0);
    assert.equal((await find({ q:'does-not-exist' })).length,0);
    const submit = (user,id,letter) => detail.answerPublicQuestion(client,user,{question_id:id,selected_answer:letter});
    assert.equal((await submit(null,1,'B')).body.correct,false);
    assert.equal((await client.query('SELECT * FROM question_answer_stats')).rowCount,0);
    assert.equal((await submit('user',1,'B')).body.explanation,'official explanation');
    assert.equal((await submit('user',1,'C')).body.correct,true);
    const recorded = await client.query('SELECT * FROM question_answer_stats'); assert.equal(recorded.rowCount,1); assert.equal(recorded.rows[0].selected_answer,'B');
    assert.equal((await submit(null,26,'A')).status,404);
    assert.equal((await submit(null,999,'A')).status,404);
    assert.equal((await submit('user',27,'A')).body.available,false);
    await client.query("UPDATE questions SET answer=' ', explanation=NULL WHERE id=2");
    assert.equal((await submit('user',2,'A')).body.available,false);
    await client.query("UPDATE questions SET explanation=NULL WHERE id=3");
    assert.equal((await submit(null,3,'A')).body.explanation,'');
    assert.equal((await client.query('SELECT * FROM question_answer_stats')).rowCount,1);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
