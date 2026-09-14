import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3142';
mkdirSync('.tmp/custom-plan-artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  let mode = 'custom', fail = false;
  const state = { mode, owner: 'custom-fixture', date: '2026-09-14', plan: null, task: null, history: [], receipts: [] };
  function estimate(config) { return { days: 10, suggested: 4, target: config.target ?? 4, estimatedDays: 2, estimatedDate: '2026-09-15', overdue: false, behind: false, total: 40, remaining: 40 - state.receipts.length, completed: state.receipts.length, excluded: 0, correct: state.receipts.filter(row => row.correct).length, answered: state.receipts.length }; }
  await page.route('**/api/study-plan', async route => { if (route.request().method() === 'PUT') mode = route.request().postDataJSON().mode; return route.fulfill({ json: { mode } }); });
  await page.route('**/api/study-plan/custom', async route => {
    if (fail) return route.fulfill({ status: 503, json: { error: '測試連線失敗，請重試。' } });
    state.mode = mode;
    const request = route.request(), body = request.method() === 'GET' ? {} : request.postDataJSON();
    if (body.action === 'preview') return route.fulfill({ json: estimate(body.config) });
    if (request.method() === 'PUT') state.plan = { id: 'plan-fixture', config: body, status: 'active', started: state.date, completedAt: null, estimate: estimate(body) };
    if (body.action === 'start' && state.plan && !state.task && mode === 'custom') state.task = { id: 'task-fixture', target: state.plan.config.target, total: 30, answered: 0, completed: false, correct: null, current: { position: 1, question: '自訂測試題目', options: ['選項一', '選項二'], image: null } };
    if (typeof body.paused === 'boolean') state.plan.status = body.paused ? 'paused' : 'active';
    if (body.answer) {
      assert.equal(body.position, state.task.current.position);
      state.receipts.push({ eventId: `custom-session:${body.position}`, id: body.position, subject: '獸醫病理學', question: '自訂測試题目', options: ['選項一', '選項二'], answer: 'A', userAnswer: body.answer, correct: body.answer === 'A', explanation: '解析', image: null });
      state.task.answered++; state.plan.estimate = estimate(state.plan.config);
      if (state.task.answered === 30) { state.task.completed = true; state.task.correct = 29; state.task.current = null; }
      else state.task.current.position++;
    }
    return route.fulfill({ json: state });
  });
  await page.goto(base + '/study-plan/custom'); await page.getByRole('heading', { name: '建立學習計畫', exact: true }).waitFor();
  await page.getByRole('button', { name: '30 題', exact: true }).click();
  await page.getByLabel('民國年／月／日', { exact: true }).fill('115/9/23');
  await page.getByLabel('獸醫病理學', { exact: true }).check();
  await page.getByText('整科 · 可指定章節', { exact: true }).click();
  await page.getByLabel('腫瘤', { exact: true }).check();
  await page.getByText('目前符合範圍：40 題；', { exact: false }).waitFor();
  for (const width of [320, 375, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'form overflow ' + width); }
  await page.setViewportSize({ width: 375, height: 900 }); await page.screenshot({ path: '.tmp/custom-plan-artifacts/mobile-form.png', fullPage: true });
  await page.getByRole('button', { name: '建立計畫', exact: true }).click(); await page.getByRole('heading', { name: '我的學習計畫', exact: true }).waitFor();
  assert.deepEqual(state.plan.config.scope, [{ subject: '獸醫病理學', chapters: ['腫瘤'] }]);
  await page.getByRole('button', { name: '開始今日進度', exact: true }).click(); await page.getByRole('group', { name: '自訂進度答案選項' }).waitFor();
  for (let position = 1; position <= 12; position++) { await page.getByRole('button', { name: position === 1 ? 'B 選項二' : 'A 選項一', exact: true }).click(); await page.getByRole('button', { name: '送出並繼續', exact: true }).click(); await page.getByText(`已完成 ${position} / 30 題（今日目標 30 題）`, { exact: true }).waitFor(); }
  await page.reload(); await page.getByText('已完成 12 / 30 題（今日目標 30 題）', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('dailyProgress')))[0].completed), 12);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('wrongQuestions')).length), 1);
  await page.getByRole('button', { name: '修改計畫', exact: true }).click(); await page.getByLabel('自訂題數（1～200）', { exact: true }).fill('50');
  await page.getByRole('button', { name: '儲存計畫', exact: true }).click(); await page.getByText('你的目標：每日 50 題', { exact: false }).waitFor(); assert.equal(state.task.total, 30);
  await page.getByRole('button', { name: '暫停目前計畫', exact: true }).click(); await page.getByRole('heading', { name: '計畫已暫停', exact: true }).waitFor(); assert.equal(await page.getByRole('group', { name: '自訂進度答案選項' }).count(), 0);
  await page.getByRole('button', { name: '恢復計畫', exact: true }).click(); await page.getByRole('group', { name: '自訂進度答案選項' }).waitFor();
  mode = 'coach'; await page.reload(); await page.getByRole('heading', { name: '自訂計畫已保留', exact: true }).waitFor();
  mode = 'custom'; await page.reload(); await page.getByText('已完成 12 / 30 題（今日目標 30 題）', { exact: true }).waitFor();
  fail = true; await page.getByRole('button', { name: 'A 選項一', exact: true }).click(); await page.getByRole('button', { name: '送出並繼續', exact: true }).click(); await page.getByText('測試連線失敗，請重試。', { exact: true }).waitFor(); assert.equal(state.task.answered, 12); fail = false;
  for (let position = 13; position <= 30; position++) { await page.getByRole('button', { name: 'A 選項一', exact: true }).click(); await page.getByRole('button', { name: '送出並繼續', exact: true }).click(); await page.getByText(`已完成 ${position} / 30 題（今日目標 30 題）`, { exact: true }).waitFor(); }
  await page.getByText('今日進度完成，正確 29 / 30 題。', { exact: true }).waitFor();
  for (const width of [320, 375, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'progress overflow ' + width); }
  await page.setViewportSize({ width: 375, height: 900 }); await page.screenshot({ path: '.tmp/custom-plan-artifacts/mobile-progress.png', fullPage: true });
  await page.goto(base + '/study-plan'); await page.getByRole('heading', { name: '我的學習計畫', exact: true }).waitFor();
  assert.deepEqual(errors, []); console.log('PASS custom creation/official chapter/preview/12-of-30 resume/edit/pause/mode switch/retry/progress/wrong bridge/30 answers/four widths');
} finally { await browser.close(); }
