import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

// Run the actual page handlers and loading effect without a browser, database,
// or network. Only React's hook scheduler and external side effects are mocked.
function load(path, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'exports', 'fetch', 'window', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'react/jsx-runtime') return jsx;
    if (name.endsWith('.module.css')) return { default: {} };
    if (name === '@/lib/question-answer' || name === './question-answer') return load('lib/question-answer.ts');
    if (name === '@/lib/quiz-progress') return load('lib/quiz-progress.ts');
    throw Error('Unexpected import ' + name);
  }, exports, globals.fetch, globals.window);
  return exports;
}

function nodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  if (!React.isValidElement(tree)) return [];
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props.children, predicate)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  if (React.isValidElement(tree)) return text(tree.props.children);
  return tree == null || typeof tree === 'boolean' ? '' : String(tree);
}
function button(tree, label) {
  const found = nodes(tree, node => node.type === 'button' && text(node).includes(label));
  assert.equal(found.length, 1, `Expected one ${label} button`);
  return found[0];
}
const question = { id: 1, questionSetId: 1, questionNumber: 1, question: 'fixture', subject: '獸醫病理學', examYear: 115, options: ['a', 'b', 'c', 'd'], answer: 'A', explanation: '', questionSetName: 'fixture' };
const Card = load('components/questions/QuestionCard.tsx', { '@/components/dashboard/StudyUI': { StudyIcon: () => null } }).default;
const blank = () => null;
const link = ({ href, children }) => React.createElement('a', { href }, children);

async function fixture(data, query = 'started=1&mode=practice&count=30') {
  const slots = [], effects = [], cleanups = [];
  let cursor = 0;
  const writes = { progress: [], wrong: [], daily: 0, statistics: [], requests: [] };
  const hooks = {
    Suspense: React.Suspense,
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, index) => !Object.is(value, previous[index]))) {
        slots[i] = deps;
        effects.push(() => { cleanups[i]?.(); cleanups[i] = effect(); });
      }
    },
  };
  const Page = load('app/questions/page.tsx', {
    react: hooks,
    'next/navigation': { useSearchParams: () => new URLSearchParams(query) },
    'next/link': { default: link },
    '@/components/questions/QuestionCard': { default: Card },
    '@/components/LearningStatus': { default: blank },
    '@/app/subjects/page': { default: blank },
    '@/components/dashboard/StudyUI': { StudyIcon: blank, ProgressBar: ({ value }) => React.createElement('progress', { value, max: 100 }) },
    '@/components/ui/ContentState': {
      LoadingState: ({ label }) => React.createElement('p', null, label),
      EmptyState: ({ title, description, children }) => React.createElement('section', null, title, description, children),
    },
    '@/components/ui/ImageViewer': { default: blank },
    '@/components/questions/OptionDistribution': { default: blank },
    '@/lib/exam-year': { formatExamYear: String },
    '@/data/progress': { saveProgress: (...args) => writes.progress.push(args) },
    '@/data/wrongAnswers': { saveWrongQuestion: (...args) => writes.wrong.push(args) },
    '@/data/tasksProgress': { addDailyProgress: () => writes.daily++ },
    '@/data/favorites': { getFavorites: () => [], toggleFavorite: () => [] },
    '@/lib/answer-statistics-client': { sendStatistics: async (...args) => { writes.statistics.push(args); } },
    '@/lib/learning-client': { subscribeLearning: () => () => {} },
  }, {
    fetch: async (url, options) => { writes.requests.push({ url, options }); return { ok: true, json: async () => data }; },
    window: { setTimeout: () => 1, clearTimeout() {} },
  }).default;
  // The Suspense child gives access to QuestionsContent without editing exports.
  const Content = Page().props.children.type;
  const render = () => { cursor = 0; return Content(); };
  const initial = render();
  assert(renderToStaticMarkup(initial).includes('正在準備你的測驗'));
  effects.splice(0).forEach(effect => effect());
  await new Promise(resolve => setImmediate(resolve));
  const card = tree => {
    const found = nodes(tree, node => node.type === Card);
    assert.equal(found.length, 1);
    return found[0].props;
  };
  return { render, card, writes, close: () => cleanups.forEach(cleanup => cleanup?.()) };
}

function assertNoWrites(writes) {
  assert.deepEqual(writes.progress, []);
  assert.deepEqual(writes.wrong, []);
  assert.equal(writes.daily, 0);
  assert.deepEqual(writes.statistics, []);
}

test('practice handler rejects missing or unusable answers even when called directly', async () => {
  for (const patch of [{ answer: null }, { answer: '' }, { answer: 'AB' }, { answer: 'F' }, { answer: 'E' }, { options: ['\u00a0', 'b'] }]) {
    const app = await fixture({ questions: [{ ...question, ...patch }] }, 'started=1&questionId=1');
    try {
      const before = app.render();
      app.card(before).chooseAnswer('A');
      app.card(before).chooseAnswer('B');
      const after = app.render();
      assert.equal(app.card(after).selected, '');
      assert.equal(app.card(after).showResult, false);
      assert(renderToStaticMarkup(after).includes('待核對'));
      assertNoWrites(app.writes);
    } finally { app.close(); }
  }
});

test('direct pending question can finish with zero saved progress and no score denominator', async () => {
  const app = await fixture({ questions: [{ ...question, answer: null }] }, 'started=1&questionId=1');
  try {
    button(app.render(), '完成測驗').props.onClick();
    const result = text(app.render());
    assert(result.includes('完成這次測驗了'));
    assert(result.includes('0 / 0'));
    assert(result.includes('已作答 0 題 · 有效計分 0 題 · 待核對 1 題'));
    assert(result.includes('暫無可判分題目'));
    assert(!result.includes('NaN'));
    assertNoWrites(app.writes);
  } finally { app.close(); }
});

test('answer without explanation records and updates session progress exactly once', async () => {
  const app = await fixture({ questions: [{ ...question, explanation: ' \t\u00a0' }] });
  try {
    const choose = app.card(app.render()).chooseAnswer;
    choose('A'); choose('A'); choose('B'); // Repeated/stale callbacks before rerender.
    const answered = app.render();
    app.card(answered).chooseAnswer('B'); // Repeated callback after rerender.
    assert.equal(app.card(answered).selected, 'A');
    assert.equal(app.card(answered).answered, true);
    assert(renderToStaticMarkup(answered).includes('目前沒有提供解析。'));
    assert(text(answered).includes('已作答 1 題 · 有效計分 1 題 · 待核對 0 題 · 答對 1 / 1 題'));
    assert.deepEqual(app.writes.progress, [[1, true, question.subject]]);
    assert.deepEqual(app.writes.wrong, []);
    assert.equal(app.writes.daily, 1);
    assert.deepEqual(app.writes.statistics, [[[ { question_id: 1, selected_answer: 'A' } ]]]);
    button(answered, '完成測驗').props.onClick();
    const result = text(app.render());
    assert(result.includes('1 / 1'));
    assert(result.includes('正確率 100%'));
    assert.equal(app.writes.progress.length, 1);
  } finally { app.close(); }
});

test('pending question can be skipped and a later wrong answer counts only once', async () => {
  const app = await fixture({ questions: [{ ...question, answer: null }, { ...question, id: 2 }] });
  try {
    button(app.render(), '下一題').props.onClick();
    app.card(app.render()).chooseAnswer('B');
    button(app.render(), '完成測驗').props.onClick();
    const result = text(app.render());
    assert(result.includes('0 / 1'));
    assert(result.includes('已作答 1 題 · 有效計分 1 題 · 待核對 1 題'));
    assert.deepEqual(app.writes.progress, [[2, false, question.subject]]);
    assert.equal(app.writes.wrong.length, 1);
    assert.equal(app.writes.daily, 1);
    assert.deepEqual(app.writes.statistics, [[[ { question_id: 2, selected_answer: 'B' } ]]]);
  } finally { app.close(); }
});

test('exam manual submission excludes pending answers and repeated submit does not double-write', async () => {
  const app = await fixture({ questions: [{ ...question }, { ...question, id: 2, answer: null }] }, 'started=1&mode=exam');
  try {
    app.card(app.render()).chooseAnswer('A');
    assertNoWrites(app.writes);
    button(app.render(), '下一題').props.onClick();
    app.card(app.render()).chooseAnswer('B');
    const submit = button(app.render(), '交卷').props.onClick;
    submit(); submit();
    assert.deepEqual(app.writes.progress, [[1, true, question.subject]]);
    assert.equal(app.writes.daily, 1);
    assert.deepEqual(app.writes.statistics, [[[{ question_id: 1, selected_answer: 'A' }], 'exam']]);
    const result = text(app.render());
    assert(result.includes('1 / 1'));
    assert(result.includes('已作答 1 題 · 有效計分 1 題 · 待核對 1 題'));
  } finally { app.close(); }
});

test('exam automatic submission and a stale manual-submit callback share one write guard', async () => {
  const app = await fixture({ questions: [question] }, 'started=1&mode=exam');
  try {
    const initial = app.render(), choose = app.card(initial).chooseAnswer, submit = button(initial, '交卷').props.onClick;
    choose('A'); choose('B'); submit(); submit();
    assert.deepEqual(app.writes.progress, [[1, true, question.subject]]);
    assert.equal(app.writes.daily, 1);
    assert.deepEqual(app.writes.statistics, [[[{ question_id: 1, selected_answer: 'A' }], 'exam']]);
    assert(text(app.render()).includes('完成這次測驗了'));
  } finally { app.close(); }
});

test('empty results and a short result with sparse options render safely', async () => {
  for (const data of [{}, { questions: [] }]) {
    const app = await fixture(data);
    try {
      assert(renderToStaticMarkup(app.render()).includes('目前沒有符合條件的題目'));
      assertNoWrites(app.writes);
    } finally { app.close(); }
  }
  const app = await fixture({ questions: [{ ...question, options: ['', 'b'], answer: 'B' }] });
  try {
    const page = app.render();
    assert(text(page).includes('第 1 / 1 題'));
    assert(!renderToStaticMarkup(page).includes('NaN'));
    assert(app.writes.requests[0].url.includes('scope=public'));
    app.card(page).chooseAnswer('B');
    button(app.render(), '完成測驗').props.onClick();
    assert(text(app.render()).includes('1 / 1'));
    assert.equal(app.writes.progress.length, 1);
  } finally { app.close(); }
});
