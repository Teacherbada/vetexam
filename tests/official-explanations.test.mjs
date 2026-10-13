import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fixture, service, load } from './helpers/official-explanation-fixture.mjs';

const url = 'http://localhost/api/admin/questions/explanation';
const req = (method, body, user = 'fixture-admin', extra = {}) => new Request(url + (method === 'GET' ? '?id=1' : ''), {
  method, headers: { 'content-type': 'application/json', ...(user ? { 'x-fixture-user': user } : {}), ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const markdown = '### 核心考點\n\n**正確答案：C**\n中文與 pharmacokinetics\n第二行\n\n- 重點一\n- 重點二\n\n1. 順序一\n2. 順序二\n\n[參考](https://example.test/reference)\n\nhttps://example.test/direct';

test('real SQL: add, reload, edit, retry, conflict, rollback; preserve all other fields/records/banks', async () => {
  const f = await fixture();
  try {
    const before = await f.sql.query('SELECT * FROM questions ORDER BY id', []);
    const first = await service.readExplanation(f.sql.query, 1);
    assert.equal(first.explanation, '');
    const saved = await f.save({ ...first, explanation: markdown });
    assert.equal((await service.readExplanation(f.sql.query, 1)).explanation, markdown);
    assert.deepEqual(await f.save({ ...first, explanation: markdown }), saved, 'retry is idempotent');
    await assert.rejects(f.save({ ...first, explanation: 'stale update' }), { status: 409 });
    const second = await service.readExplanation(f.sql.query, 2);
    assert.equal(second.explanation, '既有解析不能遺失');
    await f.save({ ...second, explanation: second.explanation + '\n\n' + markdown });
    await assert.rejects(f.db.transaction(async tx => {
      await service.saveExplanation(tx, { ...saved, explanation: 'should rollback' }); throw Error('rollback test');
    }), /rollback test/);
    assert.equal((await service.readExplanation(f.sql.query, 1)).explanation, markdown);
    for (const id of [3, 4, 999]) {
      await assert.rejects(service.readExplanation(f.sql.query, id), { status: 404 });
      await assert.rejects(f.save({ ...saved, id }), { status: 404 });
    }
    const after = await f.sql.query('SELECT * FROM questions ORDER BY id', []);
    const strip = rows => rows.map(value => { const row = { ...value }; delete row.explanation; return row; });
    assert.deepEqual(strip(before), strip(after));
    assert.deepEqual(after.slice(2), before.slice(2));
    assert.deepEqual(await f.sql.query('SELECT * FROM question_answer_stats', []), [{ id: 1, question_id: 1, selected_answer: 'A' }]);
    assert.equal((await f.sql.query('SELECT content FROM ai_questions', []))[0].content.explanation, '獸醫練功房原解析');
  } finally { await f.close(); }
});

test('real guard and API: admin only, narrow payload, body limits, CSRF, conflicts, no admin data', async () => {
  const f = await fixture();
  try {
    for (const user of [null, 'member', 'fixture-admin-other']) {
      assert.equal((await f.route.GET(req('GET', undefined, user))).status, 403);
      assert.equal((await f.route.PATCH(req('PATCH', {}, user))).status, 403);
    }
    const response = await f.route.GET(req('GET'));
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const saved = await response.json();
    assert.deepEqual(Object.keys(saved).sort(), ['explanation', 'id', 'revision']);
    for (const bad of [{ answer: 'A' }, { question: 'overwrite' }, { userId: 'member' }, { kind: 'ai' }, { explanation: '' }, { explanation: '  \n' }, { explanation: 'x'.repeat(20001) }, { explanation: '\0' }, { id: -1 }, { id: '1' }, { revision: 'bad' }]) {
      assert.equal((await f.route.PATCH(req('PATCH', { ...saved, explanation: markdown, ...bad }))).status, 400);
    }
    assert.equal((await f.route.PATCH(req('PATCH', { ...saved, explanation: markdown }, 'fixture-admin', { origin: 'https://evil.test' }))).status, 403);
    assert.equal((await f.route.PATCH(req('PATCH', { ...saved, explanation: markdown }, 'fixture-admin', { 'sec-fetch-site': 'cross-site' }))).status, 403);
    assert.equal((await f.route.PATCH(req('PATCH', { ...saved, explanation: markdown }, 'fixture-admin', { 'content-type': 'text/plain' }))).status, 415);
    assert.equal((await f.route.PATCH(req('PATCH', { ...saved, explanation: '中'.repeat(22000) }))).status, 413);
    assert.equal((await f.route.PATCH(req('PATCH', { ...saved, explanation: '中'.repeat(20000) }))).status, 200);
    const stale = await f.route.PATCH(req('PATCH', { ...saved, explanation: markdown }));
    assert.equal(stale.status, 409); assert.match((await stale.json()).error, /草稿/);
  } finally { await f.close(); }
});

test('shared Markdown preview/display: Chinese, English, lists, links, safe HTML and protocols', () => {
  const Official = load('components/questions/OfficialExplanation.tsx', { 'react-markdown': Markdown, 'remark-gfm': remarkGfm }).default;
  const render = content => renderToStaticMarkup(React.createElement(Official, { content }));
  const html = render(markdown);
  for (const match of ['<h3>核心考點</h3>', '<strong>正確答案：C</strong>', 'pharmacokinetics', '<ul>', '<ol>', 'href="https://example.test/reference"', 'href="https://example.test/direct"', 'rel="noopener noreferrer"']) assert(html.includes(match), match);
  const unsafe = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n[unsafe2](data:text/html,test)\n\n![remote](https://example.test/track)');
  assert(!/<script|<img|onerror=|href="(?:javascript|data):/.test(unsafe));
  const Card = load('components/questions/QuestionCard.tsx', {
    '@/components/dashboard/StudyUI': { StudyIcon: () => null },
    '@/lib/question-answer': load('lib/question-answer.ts'), './OfficialExplanation': { default: Official, __esModule: true },
  }).default;
  const props = { currentQuestion: { id: 1, options: ['a','b','c','d'], answer: 'C', question: '題目', explanation: markdown }, selected: '', answered: false, isFavorite: false, favoriteQuestion() {}, chooseAnswer() {}, officialExplanation: true };
  assert(!renderToStaticMarkup(React.createElement(Card, { ...props, showResult: false })).includes('核心考點'));
  assert(renderToStaticMarkup(React.createElement(Card, { ...props, showResult: true })).includes('<h2>官方解析</h2>'));
  assert(renderToStaticMarkup(React.createElement(Card, { ...props, showResult: true, currentQuestion: { ...props.currentQuestion, explanation: '' } })).includes('目前沒有提供解析。'));
  const legacy = renderToStaticMarkup(React.createElement(Card, { ...props, officialExplanation: false, showResult: true }));
  assert(legacy.includes('### 核心考點')); assert(!legacy.includes('<h3>核心考點</h3>'));
});

test('student render integrations stay within existing reveal branches', () => {
  const quiz = readFileSync(new URL('../app/questions/page.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../app/questions/[id]/QuestionDetail.tsx', import.meta.url), 'utf8');
  assert(quiz.includes('<QuestionCard officialExplanation'));
  assert(quiz.indexOf('if (finished)') < quiz.indexOf('<OfficialExplanation'));
  assert(detail.indexOf('{result?.available &&') < detail.indexOf('<OfficialExplanation'));
});
