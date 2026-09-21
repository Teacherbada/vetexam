// Real import UIs; intercepted provider/auth/save responses, no production writes or AI charges.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const base = process.env.TEST_BASE_URL || 'http://localhost:3218';
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const saves = [], chunks = []; let calls = 0, failBatch = false, total = 3;
  const qs = () => Array.from({ length: total }, (_, i) => ({ id: i + 1, subject: '獸醫病理學', question: `第 ${i + 1} 題 ${'long-unbroken-question'.repeat(12)}`, options: ['甲', '乙', '丙', '丁'], answer: 'B', explanation: '既有解析' }));
  const suggestion = (index) => ({ suggestedChapter: index % 3 === 0 ? '泌尿系統' : index % 3 === 1 ? '腫瘤' : null,
    confidence: index % 3 === 0 ? 0.94 : index % 3 === 1 ? 0.84 : 0, secondChoice: index % 3 === 2 ? null : '循環障礙', reason: '依主要考點判斷。' });
  await page.route('**/api/auth/get-session**', route => route.fulfill({ json: { user: { id: 'fixture', name: 'Fixture', email: 'fixture@example.test', emailVerified: true }, session: { id: 'fixture', userId: 'fixture', expiresAt: new Date(Date.now() + 86400000).toISOString() } } }));
  await page.route('**/api/admin/status', route => route.fulfill({ json: { isAdmin: true } }));
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: { plan: 'pro', status: 'active' } } }));
  await page.route('**/api/admin/questions/chapters?**', route => route.fulfill({ json: { progress: { total: 0, classified: 0, unclassified: 0 }, matching: 0, question: null } }));
  await page.route('**/api/question-sets', route => {
    if (route.request().method() === 'POST') saves.push(route.request().postDataJSON());
    return route.fulfill({ json: route.request().method() === 'GET' ? { questionSets: [] } : { questionSetId: 100 } });
  });
  await page.route('**/api/question-sets/batch', route => {
    const body = route.request().postDataJSON(); chunks.push(body);
    return route.fulfill({ json: { complete: body.batchIndex === body.ranges.length - 1, questionSetId: 101 } });
  });
  await page.route('**/api/manual-questions', route => { saves.push(route.request().postDataJSON()); return route.fulfill({ json: { total: 1 } }); });
  await page.route('**/api/pdf', route => route.fulfill({ json: { questions: qs(), fileHash: 'a'.repeat(64) } }));
  await page.route('**/api/admin/questions/classify', route => {
    calls++; const body = route.request().postDataJSON();
    assert(body.questions.length <= 20); assert.equal(body.examSubject, '獸醫病理學');
    assert(body.questions.every(q => q.options.length >= 4 && typeof q.answer === 'string' && typeof q.explanation === 'string'));
    const failure = failBatch === true || (failBatch === 'last' && body.questions[0].question.startsWith('第 21 題'));
    return failure ? route.fulfill({ status: 503, json: { error: 'fixture failure' } }) : route.fulfill({ json: { results: body.questions.map((_, i) => suggestion(failBatch === 'last' ? 0 : i)) } });
  });
  const panel = page.getByRole('region', { name: '匯入章節分類', exact: true });
  const save = () => page.getByRole('button', { name: '確認匯入私人題庫', exact: true }).click();
  const parse = async () => {
    await page.goto(base + '/pdf');
    await page.locator('#exam-subject').selectOption('獸醫病理學');
    await page.locator('#exam-year').selectOption({ index: 1 });
    await page.getByLabel('選擇國考 PDF 檔案').setInputFiles({ name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fixture') });
    await page.getByRole('button', { name: '開始解析 PDF', exact: true }).click();
    await panel.waitFor();
  };
  const classified = () => panel.getByText(/AI 章節分類完成 · 共/).waitFor();

  // A: Whole bank chapter skips AI completely.
  await parse(); await panel.getByLabel('分類方式').selectOption('same');
  await panel.getByLabel('整份題庫章節').selectOption('腫瘤'); await save();
  await page.getByText(/✅ 已確認匯入/).waitFor(); assert.equal(calls, 0);
  assert.deepEqual(saves.at(-1).questions.map(q => q.chapter), ['腫瘤', '腫瘤', '腫瘤']);

  // B/C/D/E: First save classifies and stops for review; low requires decision; high is editable.
  await parse(); const before = saves.length; await save(); await classified(); assert.equal(saves.length, before);
  const high = panel.locator('details').filter({ has: page.locator('summary', { hasText: '高信心分類' }) }).first();
  assert.equal(await high.getAttribute('open'), null);
  const low = panel.getByRole('article', { name: '第 2 題分類', exact: true });
  await low.waitFor(); await save(); assert.equal(saves.length, before);
  await low.getByLabel('修改第 2 題章節').selectOption('炎症反應、癒合及免疫病理');
  await high.locator('summary').first().click();
  await panel.getByLabel('修改第 1 題章節').selectOption('呼吸系統');
  await mkdir('.tmp/ai-chapter-artifacts', { recursive: true });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`);
    for (const box of await panel.locator('select,button').evaluateAll(elements => elements.filter(el => el.getClientRects().length).map(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })))) assert(box.left >= 0 && box.right <= width + 1);
    await panel.screenshot({ path: `.tmp/ai-chapter-artifacts/review-${width}.png` });
  }
  await save(); await page.getByText(/✅ 已確認匯入/).waitFor();
  assert.deepEqual(saves.at(-1).questions.map(q => q.chapter), ['呼吸系統', '炎症反應、癒合及免疫病理', null]);
  assert.deepEqual(saves.at(-1).questions.map(q => [q.answer, q.explanation]), Array(3).fill(['B', '既有解析']));

  // F and batch transport: failure stays importable with null, no rollback or missing questions.
  failBatch = true; total = 25; await parse(); await save(); await classified();
  assert.equal(calls, 3); // one earlier request plus 20+5
  await page.getByRole('checkbox', { name: '分批匯入', exact: true }).check();
  await page.getByRole('button', { name: '開始分批匯入', exact: true }).click();
  await page.getByText(/✅ 已確認匯入/).waitFor();
  assert.equal(chunks.flatMap(c => c.questions).length, 25); assert(chunks.every(c => c.questions.every(q => q.chapter === null)));

  // A later failed batch must not discard successful earlier results.
  failBatch = 'last'; await parse(); await save(); await classified(); await save();
  await page.getByText(/✅ 已確認匯入/).waitFor();
  assert.equal(saves.at(-1).questions.filter(q => q.chapter === '泌尿系統').length, 20);
  assert.equal(saves.at(-1).questions.filter(q => q.chapter === null).length, 5);

  // Edited content invalidates suggestions; later mode never invokes AI.
  failBatch = false; total = 3; await parse(); await save(); await classified();
  await page.getByRole('textbox', { name: '第 1 題題目', exact: true }).fill('修改過的考點');
  assert.equal(await panel.getByText(/AI 章節分類完成 · 共/).count(), 0);
  const savedCalls = calls; await panel.getByLabel('分類方式').selectOption('later'); await save(); await page.getByText(/✅ 已確認匯入/).waitFor();
  assert.equal(calls, savedCalls); assert(saves.at(-1).questions.every(q => q.chapter === null));

  // Both manual entry points use the live import API with the same review state.
  for (const path of ['/manual', '/pdf/manual']) {
    await page.goto(base + path); await page.setViewportSize({ width: 375, height: 900 });
    const selects = page.locator('select'); await selects.first().selectOption('獸醫病理學');
    if (path === '/manual') {
      await page.getByPlaceholder('例如：113 年獸醫師國考 解剖學').fill('測試題庫');
      await selects.nth(1).selectOption({ index: 1 });
    }
    await page.locator('textarea').first().fill('手動測試題');
    const inputs = page.locator('input:not([type=hidden]):not([type=file])');
    const offset = path === '/manual' ? 1 : 0;
    for (let i = 0; i < 4; i++) await inputs.nth(offset + i).fill(`選項 ${i + 1}`);
    // Answer select is immediately before classification mode in both pages.
    await page.locator('select').nth(path === '/manual' ? 2 : 1).selectOption('B');
    const button = page.getByRole('button', { name: path === '/manual' ? '儲存整份題庫' : '建立題庫', exact: true });
    await button.click(); await classified();
    await panel.locator('summary').filter({ hasText: '高信心分類' }).click();
    await panel.getByLabel('修改第 1 題章節').selectOption('腫瘤');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await button.click(); await page.getByText(/成功建立題庫/).waitFor();
    assert.equal(saves.at(-1).examSubject, '獸醫病理學'); assert.equal(saves.at(-1).questions[0].chapter, '腫瘤');
  }
  assert.deepEqual(errors, []);
  console.log('PASS A-H: same/later bypass AI, mixed chapters, high/low review, human overrides, failure null, batch save, stale reset, both manual routes, 320/375/768/1280 layouts');
} finally { await browser.close(); }
