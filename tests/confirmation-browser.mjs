import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
function load(path, mocks = {}) {
  const exports = {};
  new Function('require','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name => mocks[name],exports);
  return exports;
}
const chapters = load('data/exam-chapters.ts');
const rules = load('lib/weakness.ts', { '../data/exam-chapters': chapters });
const subject = chapters.EXAM_SUBJECTS[0];
const chapter = chapters.chapterGroups(subject)[0].chapters[0];
const base = process.env.TEST_BASE_URL || 'http://localhost:3129';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('.tmp/confirmation-artifacts', { recursive: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let session = null, initialCompleted = true, mode = 'coach', guest = false, available = 5, fail = false;
  const rows = [];
  const current = position => ({ position, questionId: position, subject, chapter, question: '確認題目 ' + position, options: ['選項甲','選項乙'], image: null });
  await page.route('**/api/study-plan/confirmation', route => {
    if (guest) return route.fulfill({ status: 401, json: { error: 'login' } });
    if (fail) return route.fulfill({ status: 503, json: { error: '暫時無法儲存，請重試。' } });
    if (route.request().method() === 'POST' && (!session || session.completed)) {
      session = { id: '11111111-1111-1111-1111-111111111111', total: 5, answered: 0, completed: false, shortages: [], results: [], current: current(1) };
    }
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON();
      assert.equal(input.position, session.answered + 1);
      rows.push({ question_id: input.position, subject, chapter, kind: 'confirmation', is_correct: false, answered_at: new Date().toISOString() });
      session.answered++;
      session.completed = session.answered === 5;
      session.current = session.completed ? null : current(session.answered + 1);
      available = 5 - session.answered;
    }
    return route.fulfill({ json: { mode, session, initialCompleted, targets: [subject], available: [{ subject, count: available }], analysis: rules.buildWeaknessAnalysis(session?.completed ? rows : []) } });
  });
  const url = base + '/study-plan/confirmation';
  initialCompleted = false; await page.goto(url);
  await page.getByRole('heading', { name: '請先完成初始診斷', exact: true }).waitFor();
  initialCompleted = true; await page.reload();
  await page.getByRole('button', { name: '開始弱點確認', exact: true }).click();
  await page.getByRole('heading', { name: '確認題目 1', exact: true }).waitFor();
  await page.getByRole('button', { name: 'B 選項乙', exact: true }).click();
  fail = true; await page.getByRole('button', { name: '送出並繼續', exact: true }).click();
  await page.getByText('暫時無法儲存，請重試。', { exact: true }).waitFor();
  assert.equal(session.answered, 0);
  fail = false; await page.getByRole('button', { name: '送出並繼續', exact: true }).click();
  await page.getByText('已儲存 1 / 5 題', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: '確認題目 2', exact: true }).waitFor();
  for (let i = 2; i <= 5; i++) {
    await page.getByRole('button', { name: 'B 選項乙', exact: true }).click();
    await page.getByRole('button', { name: i === 5 ? '送出並完成診斷' : '送出並繼續', exact: true }).click();
    await page.getByText(`已儲存 ${i} / 5 題`, { exact: true }).waitFor();
  }
  await page.getByRole('heading', { name: '弱點確認完成', exact: true }).waitFor();
  await page.getByRole('heading', { name: subject + ' → ' + chapter, exact: true }).waitFor();
  await page.getByText('目前沒有足夠的不同題目可供確認，請待題庫補充或間隔一段時間後再試。既有結果已保留。', { exact: true }).waitFor();
  await page.locator('details').first().locator('summary').click();
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow ' + width);
    if (width === 375 || width === 1280) await page.screenshot({ path: `.tmp/confirmation-artifacts/result-${width}.png`, fullPage: true });
  }
  await page.reload(); await page.getByRole('heading', { name: '弱點確認完成', exact: true }).waitFor();
  mode = 'custom'; await page.reload(); await page.getByRole('heading', { name: '先選擇國考教練模式', exact: true }).waitFor();
  mode = 'coach'; guest = true; await page.reload(); await page.getByRole('link', { name: '登入帳號', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS confirmation prerequisite, start, retry, resume, complete, priorities, chapter disclosure, empty availability, mode/guest guards and 4 widths');
} finally { await browser.close(); }
