import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3135';
mkdirSync('.tmp/reinforcement-artifacts', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const source = { subject: '獸醫病理學', chapter: '細胞傷害與適應', correct: 1, count: 5, accuracy: .2, status: 'strengthen' };
  let state = { mode: 'coach', task: null, next: source, session: null, attempts: [], completed: [] };
  await page.route('**/api/notes?**', route => route.fulfill({ json: { notes: [], page: 1, hasMore: false, signedIn: true, admin: false } }));
  await page.route('**/api/study-plan/reinforcement', async route => {
    const request = route.request();
    if (request.method() === 'POST') state.task = { id: '12345678-1234-1234-1234-123456789012', ...source, source_analysis: source, status: 'reviewing', review_count: 1 };
    if (request.method() === 'PATCH') {
      const { action } = request.postDataJSON();
      if (action === 'review') state.task.status = 'reviewed';
      if (action === 'verify') {
        state.task.status = 'verifying';
        state.session = { id: '12345678-1234-1234-1234-123456789013', total: 3, answered: 0, completed: false,
          current: { position: 1, subject: source.subject, chapter: source.chapter, question: '測試題目：請選擇適當答案。', options: ['選項一', '選項二'] } };
        state.attempts = [{ id: state.session.id, attempt: 1, total: 3, answered: 0, correct: 0, repeatedCount: 2, passThreshold: .8, minQuestions: 3, completedAt: null }];
      }
      if (action === 'again') { state.task.status = 'reviewing'; state.task.review_count++; state.session = null; }
      if (action === 'defer') { state.task.paused_status = state.task.status; state.task.status = 'deferred'; }
      if (action === 'resume') state.task.status = state.task.paused_status;
    }
    if (request.method() === 'PUT') {
      state.session.answered++;
      if (state.session.answered === state.session.total) {
        state.session.completed = true; state.session.current = null;
        state.task.status = 'short_term'; state.attempts[0].correct = 3; state.attempts[0].completedAt = new Date().toISOString();
        state.completed = [{ ...source, baseline: .2, correct: 3, total: 3 }];
        state.next = { ...source, chapter: '炎症與修復' };
      } else state.session.current.position++;
    }
    await route.fulfill({ json: state });
  });
  assert.equal((await page.goto(base + '/study-plan/reinforcement')).status(), 200);
  await page.getByRole('button', { name: '開始補強', exact: true }).click();
  await page.getByText('目前這個章節還沒有可用的筆記。').waitFor();
  await page.getByRole('button', { name: '我已完成複習', exact: true }).click();
  await page.getByText('補強中・等待確認', { exact: true }).waitFor();
  assert.equal(await page.getByText('目前已達短期掌握', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '開始確認', exact: true }).click();
  await page.getByRole('heading', { name: '補強確認測驗', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '補強確認測驗', exact: true }).waitFor();
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'quiz overflow ' + width);
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: '.tmp/reinforcement-artifacts/mobile-quiz.png', fullPage: true });
  for (let position = 1; position <= 3; position++) {
    await page.getByRole('button', { name: 'A 選項一', exact: true }).click();
    await page.getByRole('button', { name: position === 3 ? '送出並完成確認' : '送出並繼續', exact: true }).click();
    if (position < 3) await page.getByText(`已儲存 ${position} / 3 題`, { exact: true }).waitFor();
  }
  await page.getByText('目前已達短期掌握', { exact: true }).waitFor();
  await page.getByRole('button', { name: '繼續下一個任務', exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'result overflow');
  await page.screenshot({ path: '.tmp/reinforcement-artifacts/mobile-result.png', fullPage: true });
  state.task.status = 'needs_work'; state.attempts[0].correct = 1; state.completed = []; state.next = null;
  await page.reload(); await page.getByRole('button', { name: '再次複習', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '開始確認', exact: true }).count(), 0);
  await page.getByRole('button', { name: '再次複習', exact: true }).click();
  await page.getByRole('button', { name: '稍後再複習', exact: true }).click();
  await page.getByRole('button', { name: '繼續補強', exact: true }).click();
  await page.getByRole('button', { name: '我已完成複習', exact: true }).waitFor();
  // Reuse exactly the same component at the coach entry.
  await page.route('**/api/study-plan', route => route.fulfill({ json: { mode: 'coach' } }));
  await page.route('**/api/study-plan/daily', route => route.fulfill({ json: { mode:'coach',owner:'fixture',date:'2026-09-14',target:20,task:null,receipts:[],active:null,next:'done' } }));
  await page.route('**/api/study-plan/diagnostic', route => route.fulfill({ json: { mode: 'coach', session: null } }));
  await page.goto(base + '/study-plan');
  await page.getByText('目前補強任務與學習建議', { exact:true }).click();
  await page.getByRole('link', { name: '繼續你的補強任務', exact: true }).waitFor();
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'coach overflow ' + width);
  }
  assert.deepEqual(errors, []);
  writeFileSync('.tmp/reinforcement-artifacts/ui-results.json', JSON.stringify({ passed: true, widths: [320,375,768,1280], flows: ['create','review','verify','resume','pass','fail','again','defer','coach entry'], errors }, null, 2));
  console.log('PASS fixture UI: create/review/verification/resume/pass/fail/review again/defer/coach entry, 4 widths, no page errors');
} finally { await browser.close(); }
