// Real /pdf UI with intercepted session/data/import responses. No real account or question writes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3114';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  for (const method of ['GET', 'PATCH']) {
    const response = await page.request.fetch(base + '/api/admin/questions/chapters', { method, ...(method === 'PATCH' ? { data: {} } : {}) });
    assert.equal(response.status(), 403);
  }
  let identity = 'guest', reads = 0, writes = 0, failSave = false;
  const bank = { id: 1, name: '115 病理', exam_subject: '獸醫病理學', exam_year: 2026, total_questions: 3, visibility: 'public', created_at: '2026-09-13' };
  const importedBank = { ...bank, id: 2, name: '115 藥理', exam_subject: '獸醫藥理學', total_questions: 1 };
  let banks = [bank];
  const rows = [1, 2, 3, 4].map(id => ({ id, question_set_id: id === 4 ? 2 : 1, question_number: id === 4 ? 1 : id,
    subject: id === 4 ? '獸醫藥理學' : '獸醫病理學', question: '測試題目 ' + id + '：' + 'long-unbroken-question'.repeat(8),
    option_a: '第一選項', option_b: '第二選項', option_c: '第三選項', option_d: '第四選項', option_e: null,
    answer: 'B', explanation: '既有解析', chapter: null, exam_year: 2026, question_set_name: id === 4 ? importedBank.name : bank.name, visibility: 'public' }));
  await page.route('**/api/auth/**', route => route.fulfill({ json: identity === 'guest' ? null : { user: { id: identity, email: identity + '@example.test', name: identity }, session: { id: 'fixture', userId: identity, expiresAt: '2099-01-01T00:00:00.000Z' } } }));
  await page.route('**/api/admin/status', route => route.fulfill({ json: { isAdmin: identity === 'admin' } }));
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: null } }));
  await page.route('**/api/question-sets', route => {
    if (route.request().method() === 'POST') { banks = [bank, importedBank]; return route.fulfill({ json: { questionSetId: 2 } }); }
    return route.fulfill({ json: { questionSets: banks } });
  });
  await page.route('**/api/admin/questions/chapters**', async route => {
    if (route.request().method() === 'PATCH') {
      writes++; const body = route.request().postDataJSON();
      assert.deepEqual(Object.keys(body).sort(), ['chapter', 'previousChapter', 'questionId']);
      if (failSave) return route.fulfill({ status: 503, json: { error: '測試儲存失敗' } });
      const q = rows.find(row => row.id === body.questionId); assert.equal(q.chapter, body.previousChapter); q.chapter = body.chapter;
      return route.fulfill({ json: { questionId: q.id, chapter: q.chapter } });
    }
    reads++; const p = new URL(route.request().url()).searchParams;
    const scope = rows.filter(q => q.subject === p.get('subject') && (!p.get('question_set_id') || q.question_set_id === Number(p.get('question_set_id'))));
    const matches = scope.filter(q => p.get('status') === 'all' || (p.get('status') === 'classified' ? q.chapter !== null : q.chapter === null));
    return route.fulfill({ json: { progress: { total: scope.length, classified: scope.filter(q => q.chapter !== null).length, unclassified: scope.filter(q => q.chapter === null).length }, matching: matches.length, question: matches.find(q => q.id > Number(p.get('after') || 0)) ?? null } });
  });
  await page.goto(base + '/pdf'); await page.getByRole('heading', { name: '請先登入管理員帳號' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '既有題目章節分類' }).count(), 0);
  identity = 'member'; await page.reload(); await page.getByRole('heading', { name: '沒有權限使用此功能' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '既有題目章節分類' }).count(), 0); assert.equal(reads, 0);
  identity = 'admin'; await page.reload(); await page.getByRole('article', { name: '目前分類題目' }).waitFor();
  const tool = page.getByRole('region', { name: '既有題目章節分類' });
  const current = tool.getByRole('article');
  assert.equal(await tool.getByLabel('分類狀態', { exact: true }).inputValue(), 'unclassified');
  assert(await tool.getByRole('button', { name: '儲存並下一題', exact: true }).isDisabled());
  await current.locator('summary').filter({ hasText: '章節：' }).click();
  await current.getByText('通論', { exact: true }).waitFor(); await current.getByText('各論', { exact: true }).waitFor();
  assert.equal(await current.getByRole('button', { name: '全部章節', exact: true }).count(), 0);
  await current.getByRole('button', { name: '腫瘤', exact: true }).click();
  await tool.getByRole('button', { name: '儲存並下一題', exact: true }).click();
  await current.getByRole('heading', { name: '第 2 題 · ID 2' }).waitFor(); await tool.getByText(/已分類 1 \/ 3/).waitFor();
  assert.equal(writes, 1); assert.equal(rows[0].chapter, '腫瘤');
  await tool.getByLabel('分類狀態', { exact: true }).selectOption('classified');
  await current.getByRole('heading', { name: '第 1 題 · ID 1' }).waitFor();
  await current.locator('summary').filter({ hasText: '章節：' }).click();
  await current.getByRole('button', { name: '造血及淋巴系統', exact: true }).click();
  failSave = true; await tool.getByRole('button', { name: '儲存並下一題', exact: true }).click();
  await tool.getByRole('alert').waitFor(); assert.equal(rows[0].chapter, '腫瘤');
  await current.getByRole('heading', { name: '第 1 題 · ID 1' }).waitFor();
  failSave = false; await tool.getByRole('button', { name: '儲存並下一題', exact: true }).click();
  await tool.getByText('已到此輪最後一題，可從第一題重新查看。').waitFor(); assert.equal(rows[0].chapter, '造血及淋巴系統');
  await tool.getByLabel('分類狀態', { exact: true }).selectOption('all'); await current.waitFor();
  await current.locator('summary').filter({ hasText: '章節：' }).click();
  await mkdir('.tmp/admin-chapter-artifacts', { recursive: true });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page ' + width);
    assert(await tool.evaluate(el => el.scrollWidth <= el.clientWidth), 'tool ' + width);
    if (width === 375) { await tool.scrollIntoViewIfNeeded(); await tool.screenshot({ path: '.tmp/admin-chapter-artifacts/tool-375.png' }); }
  }
  // Existing import flow is mocked, then the real completion state must select the imported bank and subject.
  await page.route('**/api/pdf', route => route.fulfill({ json: { questions: [{ id: 1, subject: '獸醫藥理學', question: '匯入測試', options: ['a', 'b', 'c', 'd'], answer: '', explanation: '' }], fileHash: 'a'.repeat(64), detectedOptionCount: 4 } }));
  await page.locator('#exam-subject').selectOption('獸醫藥理學'); await page.locator('#exam-year').selectOption('115');
  await page.getByLabel('選擇國考 PDF 檔案').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fixture') });
  await page.getByRole('button', { name: '開始解析 PDF', exact: true }).click(); await page.getByRole('heading', { name: '檢查解析結果' }).waitFor();
  await page.getByRole('button', { name: '確認匯入私人題庫', exact: true }).click();
  await current.getByRole('heading', { name: '第 1 題 · ID 4' }).waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="分類題庫"]')?.value === '2');
  assert.equal(await tool.getByLabel('分類科目', { exact: true }).inputValue(), '獸醫藥理學');
  await current.locator('summary').filter({ hasText: '章節：' }).click();
  assert.equal(await current.getByRole('button', { name: '腫瘤', exact: true }).count(), 0);
  await current.getByRole('button', { name: '藥理學總論', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS /pdf: guests/members denied, admin classification, save/next, edit, failure retained, filters/progress, imported bank handoff, 320/375/768/1280; fixture only.');
} finally { await browser.close(); }
