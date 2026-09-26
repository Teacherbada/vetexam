import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import nextEnv from '@next/env';
import pg from 'pg';

function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === '@/lib/question-state') return load('lib/question-state.ts');
    if (name === '@/lib/question-transaction' || name === '@/lib/learning-service') return {};
    throw new Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
const chapters = load('data/exam-chapters.ts');
const search = load('lib/question-search.ts', { '../data/exam-chapters': chapters });

// Execute the route's own SQL through a transaction-local PostgreSQL client in DB tests.
function quiz(execute) {
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
  return load('app/api/quiz/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@neondatabase/serverless': { neon: () => sql },
    '@/lib/auth': { auth: { api: { getSession: async () => null } } },
    '@/data/exam-chapters': chapters,
    '@/lib/home-public-data': load('lib/home-public-data.ts', {
      'server-only': {}, 'next/cache': { unstable_cache: fn => fn },
      '@neondatabase/serverless': { neon: () => sql }, './question-stats': {},
    }),
  });
}
function request(groups, extra = {}) {
  return new Request('https://test.local/api/quiz?' + new URLSearchParams({ scope: 'public', groups: JSON.stringify(groups), ...extra }));
}
const group = { subject: '獸醫病理學', years: [], count: 'all' };

test('fixed six-subject taxonomy preserves groups, order and chapter membership', () => {
  assert.deepEqual(chapters.EXAM_SUBJECTS, ['獸醫病理學', '獸醫藥理學', '獸醫實驗診斷學', '獸醫普通疾病學', '獸醫傳染病學', '獸醫公共衛生學']);
  assert.deepEqual(chapters.EXAM_SUBJECTS.map(subject => chapters.chapterGroups(subject).flatMap(g => g.chapters).length), [16, 13, 10, 3, 1, 5]);
  assert.deepEqual(chapters.chapterGroups(group.subject).map(g => [g.label, g.chapters.length]), [['通論', 6], ['各論', 10]]);
  assert.equal(chapters.chapterGroups(group.subject)[0].chapters[5], '腫瘤');
  assert.deepEqual(chapters.chapterGroups('獸醫傳染病學')[0].chapters, ['傳染病學']);
  for (const subject of chapters.EXAM_SUBJECTS) {
    const items = chapters.chapterGroups(subject).flatMap(g => g.chapters);
    assert.equal(new Set(items).size, items.length);
    for (const chapter of items) assert(chapters.validChapter(subject, chapter));
    for (const value of [null, undefined, '']) assert(chapters.validChapter(subject, value));
    for (const value of [[], {}, 1, 'AI新章節']) assert(!chapters.validChapter(subject, value));
  }
  assert(!chapters.validChapter('獸醫藥理學', '腫瘤'));
  assert(!chapters.validChapter('獸醫普通疾病學', '心臟'));
  assert.deepEqual(chapters.chapterGroups('__proto__'), []);
});

test('chapter search validates subject, binds SQL and retains pagination filters', () => {
  const filters = search.parseSearch({ subject: group.subject, chapter: '腫瘤', year: '115', q: '腎上腺', page: '2' });
  assert.equal(filters.invalid, false);
  const query = search.searchQuery(filters);
  assert(query.text.includes('q.chapter = $9'));
  assert(!query.text.includes('腫瘤'));
  assert.equal(query.values[8], '腫瘤');
  assert.equal(query.values[7], 20);
  const params = Object.fromEntries(new URL(search.searchUrl(filters, 3), 'https://test.local').searchParams);
  assert.equal(params.chapter, '腫瘤');
  assert.equal(search.parseSearch(params).page, 3);
  for (const input of [{ chapter: '腫瘤' }, { subject: '獸醫藥理學', chapter: '腫瘤' }, { subject: group.subject, chapter: "' OR TRUE --" }, { subject: group.subject, chapter: ['腫瘤'] }]) assert(search.parseSearch(input).invalid);
  assert(!search.searchQuery(search.parseSearch({ subject: group.subject })).text.includes('q.chapter'));
});

test('quiz rejects invalid chapters; old groups and single-question links stay valid', async () => {
  const old = process.env.DATABASE_URL; process.env.DATABASE_URL = 'fixture';
  const queries = [];
  const route = quiz(async (text, values) => { queries.push({ text, values }); return []; });
  try {
    for (const chapter of ['血液學', '不存在', 123, [], {}]) assert.equal((await route.GET(request([{ ...group, chapter }]))).status, 400);
    assert.equal(queries.length, 0);
    for (const chapter of [undefined, null, '']) {
      assert.equal((await route.GET(request([{ ...group, chapter }]))).status, 200);
      assert(!queries.at(-1).text.includes('q.chapter'));
    }
    assert.equal((await route.GET(request([{ ...group, chapter: '腫瘤', years: [110, 115] }]))).status, 200);
    assert(queries.at(-1).text.includes('q.chapter = $'));
    assert(queries.at(-1).values.includes('腫瘤'));
    assert(queries.at(-1).text.includes("qs.visibility = 'public'"));
    assert.equal((await route.GET(request([], { questionId: '1' }))).status, 200);
    assert(!queries.at(-1).text.includes('q.chapter'));
    const settings = await route.GET(request([], { settings: '1' }));
    assert.equal((await settings.json()).chapterAvailability, undefined);
  } finally { if (old === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = old; }
});

test('PostgreSQL: nullable migration, combined filters, counts, privacy, dedup and empty chapters', { skip: process.env.CHAPTER_DB_TEST !== '1' }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("CREATE TEMP TABLE question_sets(id integer PRIMARY KEY, visibility text, exam_year integer, name text)");
    await client.query("CREATE TEMP TABLE questions(id integer PRIMARY KEY, question_set_id integer, question_number integer, subject text, question text, option_a text, option_b text, option_c text, option_d text, answer text, explanation text)");
    await client.query("INSERT INTO question_sets VALUES (1,'public',115,'fixture'),(2,'public',110,'fixture'),(3,'private',115,'private')");
    await client.query("INSERT INTO questions VALUES (1,1,1,'獸醫病理學','old','a','b','c','d','A','explanation')");
    // Target only the temporary fixture, never public.questions.
    const migration = readFileSync(new URL('../migrations/20260913_exam_chapters.sql', import.meta.url), 'utf8').replace('public.questions', 'pg_temp.questions');
    await client.query(migration); await client.query(migration);
    assert.equal((await client.query('SELECT chapter FROM pg_temp.questions')).rows[0].chapter, null);
    await client.query("INSERT INTO questions SELECT i,CASE WHEN i=3 THEN 2 WHEN i=4 THEN 3 ELSE 1 END,i,CASE WHEN i=5 THEN '獸醫藥理學' ELSE '獸醫病理學' END,'fixture','a','b','c','d','A','explanation','腫瘤' FROM generate_series(2,5) i");
    const route = quiz(async (text, values) => (await client.query(text, values)).rows);
    const run = async (groups, extra) => { const res = await route.GET(request(groups, extra)); assert.equal(res.status, 200); return res.json(); };
    const ids = result => result.questions.map(q => q.id);
    assert.deepEqual(ids(await run([group])), [3, 1, 2]);
    assert.deepEqual(ids(await run([{ ...group, chapter: '腫瘤' }])), [3, 2]);
    assert.deepEqual(ids(await run([{ ...group, chapter: '腫瘤', years: [115] }])), [2]);
    assert.deepEqual(ids(await run([{ ...group, chapter: '腫瘤', years: [110, 115] }])), [3, 2]);
    assert.deepEqual(ids(await run([{ ...group, chapter: '循環障礙' }])), []);
    assert.deepEqual(ids(await run([group, { ...group, chapter: '腫瘤' }])), [3, 1, 2]);
    assert.deepEqual(ids(await run([], { questionId: '1' })), [1]);
    const settings = await run([], { settings: '1', chapters: '1' });
    assert.equal(settings.availability.filter(r => r.subject === group.subject).reduce((n, r) => n + r.count, 0), 3);
    assert.equal(settings.chapterAvailability.filter(r => r.subject === group.subject).reduce((n, r) => n + r.count, 0), 2);
    const find = async params => { const q = search.searchQuery(search.parseSearch(params)); return (await client.query(q.text, q.values)).rows.map(r => r.id); };
    assert.deepEqual(await find({ subject: group.subject }), [1, 2, 3]);
    assert.deepEqual(await find({ subject: group.subject, chapter: '腫瘤', year: '115' }), [2]);
    assert.deepEqual(await find({ subject: group.subject, chapter: '循環障礙' }), []);
    assert.equal((await client.query('SELECT chapter FROM pg_temp.questions WHERE id=1')).rows[0].chapter, null);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
