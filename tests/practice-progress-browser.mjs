import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3307';
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}) });
const errors = [];
const out = process.env.TEST_SCREENSHOT_DIR || '.tmp/practice-progress';
mkdirSync(out, { recursive: true });
const sample = { id: 9001, questionSetId: 1, questionNumber: 1, subject: '獸醫病理學', question: '測試：下列選項何者正確？', options: ['甲', '乙', '丙', '丁', '戊'], answer: 'E', explanation: '', examYear: 115, questionSetName: '測試題' };
async function setup(questions) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const posts = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const req = route.request(); const url = new URL(req.url());
    if (req.method() === 'POST') { posts.push(req.postDataJSON()); return route.fulfill({ json: { success: true } }); }
    if (url.pathname === '/api/auth/get-session') return route.fulfill({ json: null });
    if (url.pathname === '/api/quiz') return route.fulfill({ json: url.searchParams.has('settings') ? { availability: [{ subject: sample.subject, year: 115, count: questions.length }], chapterAvailability: [] } : { questions } });
    if (url.pathname === '/api/stats/weekly-most-missed') return route.fulfill({ json: { question: null, source: null, min_attempts: 10 } });
    if (url.pathname === '/api/stats/option-distribution') return route.fulfill({ json: { total: 0, sufficient: false, min_attempts: 5, options: [] } });
    return route.fulfill({ json: {} });
  });
  return { page, posts };
}
const url = (extra = {}) => base + '/questions?' + new URLSearchParams({ groups: JSON.stringify([{ subject: sample.subject, years: [], count: '20' }]), order: 'random', mode: 'practice', started: '1', ...extra });
async function fits(page, name) {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflow at ' + width);
    await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
  }
}
try {
  {
    const { page, posts } = await setup([sample]);
    await page.goto(url());
    const options = page.getByRole('group', { name: '答案選項' });
    await options.waitFor();
    assert.equal(await options.getByRole('button').count(), 5);
    assert.match(await page.getByRole('region', { name: '本次練習' }).innerText(), /1 \/ 1 題/);
    await fits(page, 'valid-before');
    await options.getByRole('button').nth(4).click();
    await page.getByRole('region', { name: '答案與解析' }).waitFor();
    assert.match(await page.getByRole('region', { name: '本次練習' }).innerText(), /已作答 1 題 · 有效計分 1 題 · 待核對 0 題 · 答對 1 \/ 1 題/);
    assert.match(await page.getByRole('region', { name: '答案與解析' }).innerText(), /目前沒有提供解析/);
    assert.equal(await options.locator('button:disabled').count(), 5);
    await fits(page, 'valid-answered');
    await page.getByRole('button', { name: '完成測驗' }).click();
    assert.match(await page.locator('main').innerText(), /已作答 1 題 · 有效計分 1 題 · 待核對 0 題/);
    await page.getByRole('button', { name: '重新測驗' }).click();
    await page.getByRole('region', { name: '本次練習' }).waitFor();
    assert.match(await page.getByRole('region', { name: '本次練習' }).innerText(), /已作答 0 題/);
    await page.goto(base);
    await page.getByText('此處只統計有效計分的作答；答案待核對的題目不計入。').waitFor();
    assert.match(await page.locator('main').innerText(), /有效計分題數\s*1 題/);
    assert.equal(posts.length, 1);
    await page.close();
  }
  {
    const { page, posts } = await setup([{ ...sample, answer: '' }]);
    await page.goto(url({ questionId: '9001' }));
    const options = page.getByRole('group', { name: '答案選項' }); await options.waitFor();
    await page.getByText('本題正確答案待核對，暫不開放作答，不計入成績與作答統計。', { exact: true }).waitFor();
    assert.equal(await options.locator('button:disabled').count(), 5);
    assert.match(await page.getByRole('region', { name: '本次練習' }).innerText(), /已作答 0 題 · 有效計分 0 題 · 待核對 1 題/);
    await fits(page, 'pending-before');
    await page.getByRole('button', { name: '完成測驗' }).click();
    assert.match(await page.locator('main').innerText(), /暫無可判分題目/);
    assert.equal(posts.length, 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('progress')), null);
    await page.close();
  }
  {
    const { page } = await setup([]); await page.goto(url());
    await page.getByText('目前沒有符合條件的題目', { exact: true }).waitFor();
    assert.equal(await page.getByRole('progressbar').count(), 0);
    await page.close();
  }
  {
    const { page, posts } = await setup([sample, { ...sample, id: 9002, answer: '' }]);
    await page.goto(url({ mode: 'exam' }));
    const options = page.getByRole('group', { name: '答案選項' }); await options.waitFor();
    await options.getByRole('button').first().click();
    assert.equal(await page.getByRole('region', { name: '答案與解析' }).count(), 0);
    await page.getByRole('button', { name: '下一題' }).click();
    assert.equal(await options.locator('button:disabled').count(), 5);
    await page.getByRole('button', { name: '上一題' }).click();
    await page.getByRole('button', { name: '交卷', exact: true }).click();
    assert.match(await page.locator('main').innerText(), /已作答 1 題 · 有效計分 1 題 · 待核對 1 題/);
    assert.equal(posts.length, 1);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: valid/no-explanation E, counts/persistence, restart, pending skip, empty pool, exam back/submit, 375/1280 layout');
} finally { await browser.close(); }
