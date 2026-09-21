import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const nativeRequire = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === 'server-only') return {};
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(resolve(name.slice(2) + '.ts'), mocks);
    if (name.startsWith('.')) return load(resolve(dirname(path), name + '.ts'), mocks);
    return nativeRequire(name);
  }, exports);
  return exports;
}
const shared = load('lib/chapter-classification.ts');
const service = load('lib/chapter-classification-service.ts');
const batch = load('lib/pdf-batch-import.ts');
const imports = load('lib/import-batches.ts');
const subject = '獸醫病理學';
const question = { question: '下列何者正確？', options: ['甲', '乙', '丙', '丁', '戊'], answer: 'B', explanation: '既有解析' };
const suggestion = { suggestedChapter: '泌尿系統', confidence: 0.94, secondChoice: '循環障礙', reason: '主要考腎小球機制。' };
function envelope(results) { return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ results }) }] }] }); }

test('threshold 0.90; low confidence is not silently accepted; invalid subject/chapters/confidence fail closed', () => {
  assert.equal(shared.toReview(suggestion).chapter, '泌尿系統');
  assert.equal(shared.needsReview(shared.toReview({ ...suggestion, confidence: 0.90 })), false);
  const low = shared.toReview({ ...suggestion, confidence: 0.899 });
  assert.equal(low.chapter, null); assert.equal(shared.needsReview(low), true);
  assert.equal(shared.needsReview({ ...low, chapter: '腫瘤', reviewed: true }), false);
  assert.equal(shared.needsReview({ ...low, chapter: null, reviewed: true }), false);
  for (const change of [{ suggestedChapter: '自創腎臟學' }, { suggestedChapter: '' }, { secondChoice: '血液學' },
    { confidence: 1.01 }, { confidence: -1 }, { confidence: '0.94' }, { confidence: NaN }, { reason: '' }, { secondChoice: '泌尿系統' }]) {
    assert.equal(shared.validateSuggestion(subject, { ...suggestion, ...change }).suggestedChapter, null);
  }
  assert.equal(shared.validateSuggestion('獸醫藥理學', suggestion).suggestedChapter, null);
});

test('batches preserve all context, cap count and text budget, isolate oversized items', () => {
  const qs = Array.from({ length: 45 }, () => question);
  assert.deepEqual(shared.classificationBatches(qs).map(x => x.length), [20, 20, 5]);
  const huge = { ...question, explanation: '字'.repeat(24001) };
  assert.deepEqual(shared.classificationBatches([question, huge, question]), [[0, 2]]);
  const larger = Array.from({ length: 25 }, () => ({ ...question, explanation: '字'.repeat(2500) }));
  assert(shared.classificationBatches(larger).every(indices => indices.reduce((n, i) => n + JSON.stringify(shared.classificationInput(larger[i])).length, 0) <= 24000));
});

test('provider sends options/answer/explanation/taxonomy with strict schema; matches reordered IDs and isolates invalid/missing/duplicate rows', async () => {
  const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'fixture-not-a-real-key';
  try {
    const result = await service.classifyChapterBatch(subject, [question, question, question, question, question], async (_, init) => {
      const body = JSON.parse(init.body), input = JSON.parse(body.input);
      assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
      assert.equal(input.exam_subject, subject); assert(input.allowedChapters.includes('腫瘤'));
      assert.deepEqual(input.questions[0], { id: 0, ...shared.classificationInput(question) });
      return envelope([{ id: 1, ...suggestion, suggestedChapter: '腫瘤' }, { id: 0, ...suggestion },
        { id: 2, ...suggestion, suggestedChapter: '不存在' }, { id: 3, ...suggestion }, { id: 3, ...suggestion }]);
    });
    assert.deepEqual(result.map(row => row.suggestedChapter), ['泌尿系統', '腫瘤', null, null, null]);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

test('missing key, HTTP failure, timeout, refusal, truncation and malformed JSON leave questions importable', async () => {
  const previous = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  try {
    assert.equal((await service.classifyChapterBatch(subject, [question], () => { throw Error('must not call'); }))[0].suggestedChapter, null);
    process.env.OPENAI_API_KEY = 'fixture';
    for (const request of [async () => new Response('', { status: 429 }), async () => { throw new DOMException('Timeout', 'TimeoutError'); },
      async () => Response.json({ status: 'incomplete', output: [] }), async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }),
      async () => new Response('broken'), async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{' }] }] })]) {
      const rows = await service.classifyChapterBatch(subject, [question, question], request);
      assert.deepEqual(rows.map(row => row.suggestedChapter), [null, null]);
    }
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});

test('classification route enforces real admin guard and payload limits before provider calls', async () => {
  const previous = { admin: process.env.ADMIN_USER_ID, db: process.env.DATABASE_URL };
  process.env.ADMIN_USER_ID = 'admin'; process.env.DATABASE_URL = 'fixture';
  let session = null, calls = 0;
  const mocks = { '@/lib/auth': { auth: { api: { getSession: async () => session } } },
    '@neondatabase/serverless': { neon: () => ({}) },
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/chapter-classification-service': { classifyChapterBatch: async () => { calls++; return [suggestion]; } } };
  const route = load('app/api/admin/questions/classify/route.ts', mocks);
  const request = data => new Request('https://test.local/api/admin/questions/classify', { method: 'POST', body: JSON.stringify(data) });
  try {
    const valid = { examSubject: subject, questions: [question] };
    assert.equal((await route.POST(request(valid))).status, 403);
    session = { user: { id: 'member', role: 'admin' } }; assert.equal((await route.POST(request(valid))).status, 403);
    session = { user: { id: 'admin' } };
    for (const invalid of [{ ...valid, examSubject: '不存在' }, { ...valid, questions: Array(21).fill(question) }, { ...valid, questions: [{ ...question, answer: 1 }] }]) assert.equal((await route.POST(request(invalid))).status, 400);
    assert.equal((await route.POST(request({ ...valid, questions: [{ ...question, question: 'a'.repeat(25000) }] }))).status, 413);
    assert.equal(calls, 0); assert.equal((await route.POST(request(valid))).status, 200); assert.equal(calls, 1);
  } finally { for (const [key, value] of [['ADMIN_USER_ID', previous.admin], ['DATABASE_URL', previous.db]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('batch transport retains human chapter, accepts legacy null, rejects invented chapter before staging', () => {
  const metadata = { filename: 'exam.pdf', fileHash: 'a'.repeat(64), visibility: 'public', examSubject: subject, examYear: 2026 };
  const make = questions => JSON.parse(imports.buildImportBatches(metadata, questions, [{ from: 1, to: questions.length }], '00000000-0000-4000-8000-000000000000')[0].body);
  assert.deepEqual(batch.parseImportBatch(make([{ ...question, chapter: '腫瘤' }, { ...question, chapter: null }])).questions.map(q => q.chapter), ['腫瘤', null]);
  assert.equal(batch.parseImportBatch(make([question])).questions[0].chapter, undefined);
  assert.throws(() => batch.parseImportBatch(make([{ ...question, chapter: 'fake' }])));
});

test('PDF and manual save routes write human-selected chapters, retain null fallback and reject invalid chapters before DB writes', async () => {
  const previous = { db: process.env.DATABASE_URL, admin: process.env.ADMIN_USER_ID };
  process.env.DATABASE_URL = 'fixture'; process.env.ADMIN_USER_ID = 'admin';
  const queries = [];
  function sql(strings, ...values) {
    const text = strings.join('?'); queries.push({ text, values });
    return Promise.resolve(text.includes('RETURNING') ? [{ id: 1 }] : []);
  }
  sql.transaction = async list => Promise.all(list);
  const mocks = { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@neondatabase/serverless': { neon: () => sql }, '@/lib/auth': { auth: { api: { getSession: async () => ({ user: { id: 'admin' } }) } } },
    '@/lib/subscription': { hasProAccess: async () => true } };
  try {
    for (const file of ['app/api/question-sets/route.ts', 'app/api/manual-questions/route.ts']) {
      const route = load(file, mocks);
      const data = { name: 'manual', filename: 'exam.pdf', examSubject: subject, examYear: 2026, questions: [{ ...question, chapter: '腫瘤' }, { ...question, chapter: null }] };
      const request = body => new Request('https://test.local', { method: 'POST', body: JSON.stringify(body) });
      queries.length = 0;
      assert.equal((await route.POST(request({ ...data, questions: [{ ...question, chapter: '血液學' }] }))).status, 400);
      assert.equal(queries.length, 0);
      assert.equal((await route.POST(request(data))).status, 200);
      const inserts = queries.filter(q => /INSERT INTO questions\s*\(/.test(q.text));
      assert.equal(inserts.length, 2); assert(inserts.every(q => q.text.includes('chapter')));
      assert.equal(inserts[0].values.at(-1), '腫瘤'); assert.equal(inserts[1].values.at(-1), null);
      assert(inserts[0].values.includes(subject)); assert(inserts[0].values.includes('既有解析')); assert(inserts[0].values.includes('B'));
    }
  } finally { for (const [key, value] of [['ADMIN_USER_ID', previous.admin], ['DATABASE_URL', previous.db]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
