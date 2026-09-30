import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import pg from 'pg';

const pendingMessage = '本題正確答案待核對，暫不開放作答，不計入成績與作答統計。';
const noExplanation = '目前沒有提供解析。';
function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'react/jsx-runtime') return jsx;
    if (name === 'server-only') return {};
    if (name.endsWith('.module.css')) return { default: {} };
    if (name === '@/lib/question-answer') return load('lib/question-answer.ts');
    throw Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!React.isValidElement(tree)) return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
const options = tree => nodes(tree, node => node.props['aria-label'] === '答案選項')
  .flatMap(group => nodes(group, node => node.type === 'button'));
const question = { id: 1, questionSetId: 1, questionNumber: 1, question: 'fixture', subject: '獸醫病理學', examYear: 115, options: ['a', 'b', 'c', 'd'], answer: 'A', explanation: '', questionSetName: 'fixture' };
const Card = load('components/questions/QuestionCard.tsx', { '@/components/dashboard/StudyUI': { StudyIcon: () => null } }).default;
const card = (patch = {}, props = {}) => Card({ currentQuestion: { ...question, ...patch }, selected: '', showResult: false, answered: false, isFavorite: false, favoriteQuestion() {}, chooseAnswer() {}, blockUnscorable: true, ...props });

test('public practice flags and disables unscorable answers before an attempt', () => {
  for (const patch of [{ answer: null }, { answer: '' }, { answer: 'AB' }, { answer: 'F' }, { answer: 'E' }, { options: ['\u00a0', 'b'] }]) {
    const tree = card(patch);
    const html = renderToStaticMarkup(tree);
    assert(html.indexOf(pendingMessage) < html.indexOf('aria-label="答案選項"'));
    assert(options(tree).length > 0);
    assert(options(tree).every(option => option.props.disabled));
    assert(!html.includes('答對了'));
  }
  // Other shared-card consumers retain their existing behavior without opt-in.
  const legacy = card({ answer: '' }, { blockUnscorable: false });
  assert(options(legacy).every(option => !option.props.disabled));
  assert(!renderToStaticMarkup(legacy).includes(pendingMessage));
});

test('valid A-E answers remain scoreable without explanations', () => {
  for (const answer of ['A', 'E', '\t b \u00a0']) {
    const patch = { answer, options: ['a', 'b', 'c', 'd', 'e'], explanation: ' \t\u00a0' };
    assert(options(card(patch)).every(option => !option.props.disabled));
    const html = renderToStaticMarkup(card(patch, { showResult: true, selected: answer.trim().toUpperCase() }));
    assert(html.includes('答對了'));
    assert(html.includes(noExplanation));
    assert(!html.includes(pendingMessage));
  }
});

function detailFixture(hasAnswer) {
  const slots = []; let index = 0, records = 0;
  const hooks = {
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
  };
  const Detail = load('app/questions/[id]/QuestionDetail.tsx', {
    react: hooks,
    'next/link': { default: ({ href, children }) => React.createElement('a', { href }, children) },
    '@/lib/exam-year': { formatExamYear: String },
    '@/components/questions/OptionDistribution': { default: () => null },
    '@/data/progress': { saveProgress() {} }, '@/data/wrongAnswers': { saveWrongQuestion() {} },
    '@/data/tasksProgress': { addDailyProgress() {} }, '@/lib/learning-client': { recordLearning() { records++; } },
  }).default;
  return { render() { index = 0; return Detail({ question: { ...question, hasAnswer }, shareUrl: null }); }, get records() { return records; } };
}

test('detail uses the same pre-attempt state and keeps explanation-less answers scoreable', async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ available: true, answer: 'A', correct: true, explanation: ' \t' }); };
  try {
    const missing = detailFixture(false), initial = missing.render();
    assert(renderToStaticMarkup(initial).includes(pendingMessage));
    assert(options(initial).every(option => option.props.disabled));
    await options(initial)[0].props.onClick();
    assert.equal(calls, 0); assert.equal(missing.records, 0);
    const valid = detailFixture(true), before = valid.render();
    assert(options(before).every(option => !option.props.disabled));
    await options(before)[0].props.onClick();
    const after = valid.render();
    assert(renderToStaticMarkup(after).includes(noExplanation));
    assert(renderToStaticMarkup(after).includes('答對'));
    assert.equal(valid.records, 1);
    assert(options(after).every(option => option.props.disabled));
  } finally { globalThis.fetch = oldFetch; }
});

test('reveal returns consistent unavailable wording without recording invalid answers', async () => {
  let writes = 0, row;
  const service = load('lib/question-detail-answer.ts', {
    './question-answer': load('lib/question-answer.ts'), './question-stats': { recordFirstAnswers: async () => { writes++; } },
  });
  const client = { query: async text => ({ rows: text.startsWith('SELECT') ? [row] : [] }) };
  for (const patch of [{ answer: null }, { answer: 'AB' }, { option_a: '\u00a0' }, { answer: 'E' }]) {
    row = { answer: 'A', option_a: 'a', option_b: 'b', ...patch };
    assert.deepEqual(await service.answerPublicQuestion(client, 'user', { question_id: 1, selected_answer: 'A' }), { status: 200, body: { available: false, message: pendingMessage } });
  }
  assert.equal(writes, 0);
  row = { answer: 'A', option_a: 'a', explanation: null };
  const result = await service.answerPublicQuestion(client, 'user', { question_id: 1, selected_answer: 'A' });
  assert.equal(result.body.available, true); assert.equal(result.body.correct, true); assert.equal(result.body.explanation, '');
  assert.equal(writes, 1);
});

test('PostgreSQL: public detail eligibility matches Unicode trimming without exposing answers', { skip: process.env.PRACTICE_DB_TEST !== '1' }, async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE question_sets(id integer, visibility text, exam_year integer)');
    await client.query('CREATE TEMP TABLE questions(id integer, question_set_id integer, question_number integer, subject text, question text, answer text, option_a text, option_b text, option_c text, option_d text, option_e text)');
    await client.query("INSERT INTO question_sets VALUES (1,'public',115),(2,'private',115)");
    for (const [id, answer, optionA] of [[1, 'A', '\u00a0'], [2, '\t A \u3000', 'a'], [3, 'E', 'a'], [4, null, 'a']]) {
      await client.query("INSERT INTO questions VALUES ($1,1,$1,'subject','fixture',$2,$3,'b','c','d',NULL)", [id, answer, optionA]);
    }
    const sql = async (strings, ...values) => (await client.query(strings.reduce((text, item, i) => text + (i ? '$' + i : '') + item, ''), values)).rows;
    const api = load('lib/public-questions.ts', { react: { cache: fn => fn }, '@neondatabase/serverless': { neon: () => sql }, './question-search': {} });
    for (const [id, hasAnswer] of [[1, false], [2, true], [3, false], [4, false]]) {
      const result = await api.getPublicQuestion(String(id));
      assert.equal(result.hasAnswer, hasAnswer); assert(!('answer' in result)); assert(!('explanation' in result));
    }
    await client.query('UPDATE questions SET question_set_id=2 WHERE id=2');
    assert.equal(await api.getPublicQuestion('2'), null);
  } finally { await client.query('ROLLBACK'); await client.end(); }
});
