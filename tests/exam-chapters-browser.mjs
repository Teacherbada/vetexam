// UI fixtures only; real SQL filtering is covered by CHAPTER_DB_TEST.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3113';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let quizGroups;
  await page.route('**/api/quiz?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('settings')) return route.fulfill({ json: {
      availability: [{ subject: '獸醫病理學', year: 115, count: 3 }, { subject: '獸醫病理學', year: 110, count: 1 }],
      chapterAvailability: [{ subject: '獸醫病理學', year: 115, chapter: '腫瘤', count: 2 }],
    } });
    quizGroups = JSON.parse(params.get('groups'));
    return route.fulfill({ json: { questions: [] } });
  });
  await page.goto(base + '/subjects');
  await page.getByRole('button', { name: '選擇獸醫病理學，設定練習' }).click();
  await page.getByText('符合條件共有 4 題', { exact: true }).waitFor();
  const picker = page.locator('details');
  await picker.locator('summary').click();
  await picker.getByText('通論', { exact: true }).waitFor();
  await picker.getByText('各論', { exact: true }).waitFor();
  assert.equal(await picker.getByRole('button').count(), 17);
  await picker.getByRole('button', { name: '腫瘤', exact: true }).click();
  await page.getByText('符合條件共有 2 題', { exact: true }).waitFor();
  await page.getByRole('button', { name: '民國 110 年（西元 2021）', exact: true }).click();
  await page.getByText('符合條件共有 0 題', { exact: true }).waitFor();
  await page.getByRole('button', { name: '全部年份', exact: true }).click();
  await picker.getByRole('button', { name: '全部章節', exact: true }).click();
  await page.getByText('符合條件共有 4 題', { exact: true }).waitFor();
  const counts = [16, 13, 10, 3, 1, 5];
  const subjects = ['獸醫病理學', '獸醫藥理學', '獸醫實驗診斷學', '獸醫普通疾病學', '獸醫傳染病學', '獸醫公共衛生學'];
  for (let i = 0; i < subjects.length; i++) {
    await page.locator('select').selectOption(subjects[i]);
    assert.equal(await picker.getByRole('button').count(), counts[i] + 1);
    assert.equal(await picker.locator('summary').textContent(), '章節：全部章節');
    if (i > 0) assert.equal(await picker.getByRole('button', { name: '腫瘤', exact: true }).count(), 0);
    await picker.getByRole('button').last().click();
  }
  const artifacts = process.env.TEST_ARTIFACT_DIR || '.tmp/chapter-artifacts';
  await mkdir(artifacts, { recursive: true });
  async function noOverflow(label) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label);
    assert(await picker.evaluate(el => el.scrollWidth <= el.clientWidth), label + ' picker');
    assert(await picker.locator('summary').evaluate(el => el.scrollWidth <= el.clientWidth), label + ' summary');
  }
  await picker.getByRole('button', { name: '畜產品衛生（含乳、肉、蛋、水產品衛生及屠宰衛生）', exact: true }).click();
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow('settings ' + width);
    if (width === 375) await page.screenshot({ path: `${artifacts}/settings-375.png`, fullPage: true });
  }
  await page.getByRole('link', { name: '開始刷題 →', exact: true }).click();
  await page.getByRole('heading', { name: '目前沒有符合條件的題目' }).waitFor();
  assert.equal(quizGroups[0].chapter, '畜產品衛生（含乳、肉、蛋、水產品衛生及屠宰衛生）');
  assert.equal(quizGroups[0].subject, '獸醫公共衛生學');

  await page.goto(base + '/questions/search');
  await page.getByLabel('科目', { exact: true }).selectOption('獸醫病理學');
  await picker.locator('summary').click();
  await picker.getByRole('button', { name: '腫瘤', exact: true }).click();
  await page.getByLabel('科目', { exact: true }).selectOption('獸醫公共衛生學');
  assert.equal(await picker.locator('summary').textContent(), '章節：全部章節');
  assert.equal(await picker.getByRole('button', { name: '腫瘤', exact: true }).count(), 0);
  const longest = '畜產品衛生（含乳、肉、蛋、水產品衛生及屠宰衛生）';
  await picker.getByRole('button', { name: longest, exact: true }).click();
  await page.getByLabel('國考年份').fill('115');
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow('search ' + width);
    if (width === 375) await page.screenshot({ path: `${artifacts}/search-375.png`, fullPage: true });
  }
  // Verify the existing GET form serializes chapter without querying the unmigrated real bank.
  const submitted = new Promise(resolve => page.route('**/questions/search?**', route => {
    resolve(new URL(route.request().url()).searchParams);
    return route.fulfill({ contentType: 'text/html', body: '<p>Search submission captured</p>' });
  }));
  await page.getByRole('button', { name: '搜尋題目', exact: true }).click();
  const params = await submitted;
  assert.equal(params.get('chapter'), longest);
  assert.equal(params.get('subject'), '獸醫公共衛生學');
  assert.equal(params.get('year'), '115');
  assert.deepEqual(errors, []);
  console.log('PASS: six subjects, pathology groups, subject reset, NULL-inclusive totals, zero counts, quiz URL, search form, widths 320/375/768/1280.');
} finally { await browser.close(); }
