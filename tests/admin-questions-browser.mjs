// Local-only fixture route is created for the browser run and removed in finally.
// All admin data requests are intercepted; no real answers or sessions are written.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = 'http://localhost:3107';
const fixtureDirectory = new URL('../app/admin-questions-ui-fixture/', import.meta.url);
const fixturePage = new URL('page.tsx', fixtureDirectory);
let browser, server, created = false;
try {
  await mkdir(fixtureDirectory);
  created = true;
  await writeFile(fixturePage, "export { default } from '../admin/questions/QuestionsAdmin';\n");
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3107'], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog = (serverLog + chunk).slice(-8000); });
  server.stderr.on('data', chunk => { serverLog = (serverLog + chunk).slice(-8000); });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(base + '/api/admin/status'); if (response.status === 401) { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw new Error('Local Next server failed: ' + serverLog);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, 'Local Next server did not become ready: ' + serverLog);
  // Real server guards are checked before fixture interception.
  const protectedPage = await fetch(base + '/admin/questions', { redirect: 'manual' });
  assert.equal(protectedPage.status, 307); assert(protectedPage.headers.get('location')?.includes('/login'));
  for (const path of ['/api/admin/questions', '/api/admin/questions/bulk-answers']) {
    const response = await fetch(base + path, path.endsWith('bulk-answers') ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' } : undefined);
    assert.equal(response.status, 403);
  }
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/auth/**', route => route.fulfill({ json: null }));
  await page.route('**/api/admin/status', route => route.fulfill({ json: { isAdmin: false } }));
  const questions = Array.from({ length: 4 }, (_, i) => ({ id: i + 1, question_set_id: 1, question_number: i + 1, subject: '獸醫病理學', question: `測試題目 ${i + 1}：請選出正確答案。`, option_a: '選項一', option_b: '選項二', option_c: '選項三', option_d: '選項四', option_e: null, answer: i === 1 ? 'B' : '', explanation: '', exam_year: 2026, question_set_name: '115 年獸醫病理學' }));
  const bank = { id: 1, name: '115 年獸醫病理學', exam_year: 2026, exam_subject: '獸醫病理學', visibility: 'public', total: 4, missing_answer: 3, missing_explanation: 4 };
  const data = { summary: { total: 4, missing_answer: 3, missing_explanation: 4, missing_both: 3, invalid: 0, answer_null: 0, answer_blank: 3 }, sets: [bank], questions, total: 4 };
  const requests = []; let applies = 0, lastPreview;
  await page.route('**/api/admin/questions?**', route => route.fulfill({ json: new URL(route.request().url()).searchParams.get('editor') === '1' ? { questions } : data }));
  await page.route('**/api/admin/questions/bulk-answers', route => {
    const body = route.request().postDataJSON(); requests.push(body);
    if (body.action === 'apply') { applies++; return route.fulfill({ json: { success: true, summary: lastPreview.summary } }); }
    let entries = body.input.answers ?? [];
    if (body.input.mode === 'single') entries = [{ question_number: body.input.question_id, answer: body.input.answer }];
    if (body.input.mode === 'sequence') entries = [...body.input.text.replace(/\s/g, '')].map((answer, i) => ({ question_number: i + 1, answer }));
    if (body.input.mode === 'table') entries = body.input.text.split('\n').map(line => ({ question_number: Number(line.match(/\d+/)[0]), answer: line.match(/[A-D]/i)[0].toUpperCase() }));
    const mismatch = body.input.mode === 'sequence' && entries.length !== questions.length;
    const rows = entries.map(entry => { const q = questions.find(q => q.question_number === entry.question_number); return { question_id: q.id, question_number: q.question_number, old_answer: q.answer, new_answer: entry.answer, status: q.answer === entry.answer ? 'same' : q.answer ? 'changed' : 'added', recalculate: q.answer && q.answer !== entry.answer ? 83 : 0, remove: q.answer && q.answer !== entry.answer ? 43 : 0 }; });
    const summary = { added: 0, changed: 0, same: 0, skipped: 0, unmatched: 0, recalculate: 0, remove: 0 };
    for (const row of rows) { summary[row.status]++; summary.recalculate += row.recalculate; summary.remove += row.remove; }
    lastPreview = { rows, summary, errors: mismatch ? ['答案數量與題目數量不一致'] : [], parsed: entries.length, expected: 4, can_apply: !mismatch, token: 'fixture-token', fingerprint: 'fixture' };
    return route.fulfill({ json: lastPreview });
  });
  await page.goto(base + '/admin-questions-ui-fixture');
  await page.getByLabel('選擇特定題庫').selectOption('1');
  await page.getByRole('button', { name: '開始鍵盤輸入', exact: true }).click();
  await page.keyboard.type('acbd');
  await page.getByRole('button', { name: '解析預覽', exact: true }).click();
  await page.getByRole('heading', { name: '解析預覽與確認' }).waitFor();
  assert.deepEqual(requests.at(-1).input.answers.map(e => e.answer), ['A', 'C', 'B', 'D']);
  assert.equal(applies, 0);
  const apply = page.getByRole('button', { name: '確認套用答案', exact: true });
  assert(await apply.isDisabled());
  await page.getByLabel('我確認套用答案並重新計算歷史統計。').check();
  assert(await apply.isDisabled());
  await page.getByLabel(/我確認清除 43 筆/).check(); assert(await apply.isEnabled());
  // Revisiting a prior question must discard both preview and confirmations.
  await page.getByRole('button', { name: '前往第 2 題，ID 2', exact: true }).click();
  await page.keyboard.type('d');
  assert.equal(await page.getByRole('heading', { name: '解析預覽與確認' }).count(), 0);
  await page.getByRole('button', { name: '解析預覽', exact: true }).click();
  await page.getByRole('heading', { name: '解析預覽與確認' }).waitFor();
  assert.equal(requests.at(-1).input.answers[1].answer, 'D'); assert(await apply.isDisabled());
  const artifacts = process.env.TEST_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page overflows at ${width}`);
    if (artifacts && (width === 375 || width === 1280)) await page.screenshot({ path: `${artifacts}/admin-questions-${width}.png`, fullPage: true });
  }
  await page.getByLabel('我確認套用答案並重新計算歷史統計。').check();
  await page.getByLabel(/我確認清除 43 筆/).check(); await apply.click();
  await page.getByText(/已完成：新增/).waitFor(); assert.equal(applies, 1);
  await page.getByRole('button', { name: '連續答案字串', exact: true }).click();
  await page.locator('textarea').fill('ACB');
  await page.getByRole('button', { name: '解析預覽', exact: true }).click();
  await page.getByText('答案數量與題目數量不一致', { exact: true }).waitFor(); assert(await apply.isDisabled());
  await page.getByRole('button', { name: '貼上答案表', exact: true }).click();
  await page.locator('textarea').fill('1、A\n2.C');
  await page.getByRole('button', { name: '解析預覽', exact: true }).click();
  await page.getByRole('heading', { name: '解析預覽與確認' }).waitFor(); assert.equal(requests.at(-1).input.question_set_id, 1);
  await page.getByRole('button', { name: '查看／編輯', exact: true }).first().click();
  await page.getByLabel('新的正確答案').selectOption('C');
  await page.getByRole('button', { name: '預覽單題修改', exact: true }).click();
  await page.getByRole('heading', { name: '解析預覽與確認' }).waitFor();
  assert.deepEqual(requests.at(-1).input, { mode: 'single', question_set_id: 1, question_id: 1, answer: 'C' });
  // Real quiz component with a missing key must not write local/server correctness.
  const missing = { id: 100, questionSetId: 1, questionNumber: 1, subject: '獸醫病理學', question: '答案空缺測試', options: ['a', 'b', 'c', 'd'], answer: '', explanation: '', examYear: 2026, questionSetName: 'fixture' };
  let writes = 0;
  await page.route('**/api/quiz?**', route => route.fulfill({ json: { questions: [missing] } }));
  await page.route('**/api/stats/answers', route => { writes++; return route.fulfill({ json: { success: true } }); });
  for (const mode of ['practice', 'exam']) {
    await page.goto(base + '/questions?started=1&mode=' + mode);
    await page.getByRole('group', { name: '答案選項', exact: true }).getByRole('button').first().click();
    await page.getByText('本題正確答案尚未設定，不計入作答統計。', { exact: true }).waitFor();
    assert.equal(writes, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('progress')), null);
  }
  assert.deepEqual(errors, []);
  console.log('PASS real anonymous guards, keyboard/revisit, preview-only paste, explicit stats confirmation, sequence length guard, single ID, mobile widths, missing-answer practice/exam; no browser errors.');
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
  if (created) { await unlink(fixturePage).catch(() => {}); await rmdir(fixtureDirectory).catch(() => {}); }
  // Discard only generated type files that still reference the removed fixture.
  for (const name of ['validator.ts', 'routes.d.ts']) {
    const generated = new URL('../.next/dev/types/' + name, import.meta.url);
    if ((await readFile(generated, 'utf8').catch(() => '')).includes('admin-questions-ui-fixture')) await unlink(generated).catch(() => {});
  }
}
