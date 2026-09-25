import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'https://vetexam-tw.vercel.app';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const get = async path => {
    const result = await page.request.get(base + path);
    assert.equal(result.status(), 200, path);
    return result.json();
  };
  assert.deepEqual(await get('/api/learning'), { owner: null });
  assert((await get('/api/stats/chapter-frequency')).rows.length > 0);
  const { availability } = await get('/api/quiz?scope=public&settings=1&chapters=1');
  assert(availability.length > 0);
  const groups = JSON.stringify([{ subject: availability[0].subject, years: [], count: '1' }]);
  const query = new URLSearchParams({ scope: 'public', groups });
  const { questions } = await get('/api/quiz?' + query);
  assert.equal(questions.length, 1);
  await get('/api/stats/difficulty?questionId=' + questions[0].id);
  for (const state of ['unanswered', 'wrong', 'favorites']) {
    query.set('state', state);
    assert.equal((await page.request.get(base + '/api/quiz?' + query)).status(), 401);
  }
  for (const path of ['/', '/analysis', '/subjects', '/favorites', '/wrong']) {
    assert.equal((await page.goto(base + path)).status(), 200);
    await page.waitForLoadState('networkidle');
    for (const width of [360, 375, 390, 412, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path + ' overflow ' + width);
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS production learning/frequency/difficulty/public quiz/account filter guards/five pages/five widths/no page errors; read-only.');
} finally {
  await browser.close();
}
