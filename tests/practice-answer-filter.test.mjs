import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import pg from 'pg';

function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'server-only') return {};
    if (name === '@/data/exam-chapters') return load('data/exam-chapters.ts');
    if (name === '@/lib/question-state') return load('lib/question-state.ts');
    if (name === '@/lib/question-transaction' || name === '@/lib/learning-service' || name === './question-stats') return {};
    throw Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
function route(execute) {
  function sql(strings, ...values) {
    const fragment = { strings, values };
    fragment.then = (resolve, reject) => {
      const params = [];
      function render(part) {
        return part.strings.reduce((text, item, index) => {
          if (!index) return item;
          const value = part.values[index - 1];
          if (value?.strings) return text + render(value) + item;
          params.push(value);
          return text + '$' + params.length + item;
        }, '');
      }
      return Promise.resolve().then(() => execute(render(fragment), params)).then(resolve, reject);
    };
    return fragment;
  }
  const shared = { '@neondatabase/serverless': { neon: () => sql } };
  return load('app/api/quiz/route.ts', {
    ...shared,
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { auth: { api: { getSession: async () => null } } },
    '@/lib/home-public-data': load('lib/home-public-data.ts', { ...shared, 'next/cache': { unstable_cache: fn => fn } }),
  });
}
const group = { subject: '獸醫病理學', years: [], count: '20' };
const request = (groups = [group], extra = {}) => new Request('https://test.local/api/quiz?' + new URLSearchParams({ scope: 'public', groups: JSON.stringify(groups), ...extra }));
async function withDatabase(fn) {
  const old = process.env.DATABASE_URL;
  process.env.DATABASE_URL ||= 'fixture';
  try { await fn(); } finally { if (old === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = old; }
}

test('practice eligibility is applied before LIMIT and matches both availability queries', () => withDatabase(async () => {
  const queries = [];
  const api = route(async (text, values) => { queries.push({ text, values }); return []; });
  assert.deepEqual(await (await api.GET(request())).json(), { questions: [] });
  const quiz = queries[0].text;
  assert(quiz.indexOf('UPPER(BTRIM(q.answer,') < quiz.indexOf('LIMIT'));
  assert.equal(queries[0].values.at(-1), 20);
  await api.GET(request([], { settings: '1', chapters: '1' }));
  const predicate = text => text.match(/UPPER\(BTRIM\(q.answer,[\s\S]*?IS NOT NULL/)?.[0].replace(/\$\d+/g, '$').replace(/\s+/g, ' ');
  assert(predicate(quiz));
  assert.equal(predicate(queries[1].text), predicate(quiz));
  assert.equal(predicate(queries[2].text), predicate(quiz));
  assert(!predicate(quiz).includes('explanation'));
  assert.deepEqual(queries[1].values, queries[0].values.slice(1, -1));
  assert.deepEqual(queries[2].values, queries[1].values);
  assert.equal(queries.length, 3, 'empty pool does not retry or refill');
  await api.GET(request([], { questionId: '1' }));
  assert(!queries.at(-1).text.includes('UPPER(BTRIM(q.answer,'));
}));

test('sparse response retains actual count and valid E option without requiring explanation', () => withDatabase(async () => {
  let calls = 0;
  const api = route(async () => { calls++; return [{ id: 1, option_a: 'a', option_b: 'b', option_c: 'c', option_d: 'd', option_e: 'e', answer: 'E', explanation: null }]; });
  const body = await (await api.GET(request())).json();
  assert.equal(calls, 1);
  assert.equal(body.questions.length, 1);
  assert.equal(body.questions[0].options[4], 'e');
  assert.equal(body.questions[0].explanation, '');
  const { usableAnswer } = load('lib/question-answer.ts');
  assert.equal(usableAnswer(body.questions[0]), 'E');
  // Existing UI uses returned length for progress and exits early for empty pools.
  const page = readFileSync(new URL('../app/questions/page.tsx', import.meta.url), 'utf8');
  assert(page.includes('if (questions.length === 0) return'));
  assert(page.includes('{questions.length} 題'));
  assert(page.includes('completedCount / questions.length * 100'));
}));

test('PostgreSQL: eligible pool, sparse/empty results, count parity, direct lookup and privacy', { skip: process.env.PRACTICE_DB_TEST !== '1' }, () => withDatabase(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE question_sets(id integer PRIMARY KEY, visibility text, exam_year integer, name text)');
    await client.query('CREATE TEMP TABLE questions(id integer PRIMARY KEY, question_set_id integer, question_number integer, subject text, chapter text, question text, option_a text, option_b text, option_c text, option_d text, option_e text, answer text, explanation text)');
    await client.query("INSERT INTO question_sets VALUES (1,'public',115,'fixture'),(2,'private',115,'private'),(3,'public',114,'empty eligible pool')");
    const rows = [
      [1, null, 'a', null], [2, '', 'a', null], [3, '   ', 'a', null], [4, 'F', 'a', null],
      [5, 'AB', 'a', null], [6, 'A', '', null], [7, 'A', ' \t\n ', null], [8, 'A', null, null],
      [15, 'E', 'a', '\u00a0'], [16, 'A', '\u202f', null], [17, 'A', '\ufeff', null],
      [9, 'A', 'a', null], [10, '\t b \u00a0', 'a', null], [11, 'E', 'a', 'e'], [12, 'E', 'a', null],
    ];
    for (const [id, answer, optionA, optionE] of rows) await client.query(
      "INSERT INTO questions VALUES ($1,1,$1,'獸醫病理學','腫瘤','fixture',$3,'b','c','d',$4,$2,NULL)", [id, answer, optionA, optionE]);
    await client.query("INSERT INTO questions VALUES (13,2,13,'獸醫病理學','腫瘤','private','a','b','c','d',NULL,'A',NULL),(14,3,14,'獸醫病理學','腫瘤','invalid','a','b','c','d',NULL,NULL,NULL)");
    let queries = 0;
    const api = route(async (text, values) => { queries++; return (await client.query(text, values)).rows; });
    async function run(groups = [group], extra = {}) { const res = await api.GET(request(groups, extra)); assert.equal(res.status, 200); return res.json(); }
    const ids = body => body.questions.map(q => q.id);
    assert.deepEqual(ids(await run()), [9, 10, 11]);
    assert.equal(queries, 1, 'sparse pool completes in one query');
    assert.deepEqual(ids(await run([{ ...group, count: '2' }])), [9, 10], 'filter must precede LIMIT');
    assert.deepEqual(ids(await run([{ ...group, count: 'all' }])), [9, 10, 11]);
    assert.deepEqual(ids(await run([group, group])), [9, 10, 11], 'deduplicate groups');
    assert.deepEqual(ids(await run([group], { order: 'random' })).sort((a, b) => a - b), [9, 10, 11]);
    assert.deepEqual(ids(await run([{ ...group, years: [114] }])), []);
    assert.deepEqual(ids(await run([{ ...group, chapter: '腫瘤', years: [115] }])), [9, 10, 11]);
    const settings = await run([], { settings: '1', chapters: '1' });
    assert.equal(settings.availability.reduce((sum, row) => sum + row.count, 0), 3);
    assert.equal(settings.chapterAvailability.reduce((sum, row) => sum + row.count, 0), 3);
    assert.deepEqual(ids(await run([], { questionId: '1' })), [1], 'unanswered direct lookup remains available');
    assert.deepEqual(ids(await run([], { questionId: '13' })), [], 'private lookup remains inaccessible');
  } finally { await client.query('ROLLBACK'); await client.end(); }
}));
