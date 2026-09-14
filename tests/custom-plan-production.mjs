import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'https://vetexam-tw.vercel.app';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/study-plan/custom', '/study-plan/daily', '/study-plan']) {
    assert.equal((await page.goto(base + path)).status(), 200);
    await page.getByRole('link', { name: '登入帳號', exact: true }).waitFor();
    for (const width of [320, 375, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path + ' overflow ' + width); }
  }
  for (const path of ['custom', 'daily', 'reinforcement', 'follow-up', 'confirmation', 'diagnostic']) {
    for (const method of ['GET', 'POST', 'PUT', ...(['custom', 'daily', 'reinforcement'].includes(path) ? ['PATCH'] : [])]) {
      const response = await page.request.fetch(`${base}/api/study-plan/${path}`, { method, headers: { origin: base }, ...(method === 'GET' ? {} : { data: {} }) });
      assert.equal(response.status(), 401, method + ' ' + path);
    }
  }
  assert.equal((await page.request.get(base + '/api/quiz?scope=public&settings=1&chapters=1')).status(), 200);
  assert.deepEqual(errors, []); console.log('PASS deployed custom/coach pages, authenticated API guards, public quiz, four widths, no page errors');
} finally { await browser.close(); }
