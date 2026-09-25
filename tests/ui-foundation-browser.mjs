import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3255';
const phase = process.env.UI_PHASE || 'after';
const out = `.tmp/ui-foundation/${phase}`;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const subjects = ['獸醫普通疾病學','獸醫病理學','獸醫藥理學','獸醫傳染病學','獸醫公共衛生學','獸醫實驗診斷學'];
try {
  for (const scenario of ['analysis', 'study-plan', 'review']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      let json = {};
      if (path === '/api/auth/get-session') json = { user: { id: 'fixture', name: 'Fixture', email: 'fixture@example.test', emailVerified: true }, session: { id: 'fixture', userId: 'fixture', expiresAt: '2099-01-01' } };
      else if (path === '/api/learning') json = { owner: 'fixture', progress: Object.fromEntries(subjects.map((s, i) => [s, { answered: Array.from({ length: 40 }, (_, n) => i * 100 + n), correct: 18 + i * 4, wrong: 22 - i * 4 }])), history: [], favorites: [], wrongQuestions: [], legacy: [] };
      else if (path === '/api/study-plan') json = { mode: 'coach' };
      else if (path === '/api/study-plan/daily') json = { mode: 'coach', owner: 'fixture', date: '2026-09-25', target: 30, task: { id: 'fixture', target: 30, total: 30, answered: 12, completed: false, correct: null, current: null, summary: [], followUpsCompleted: 0 }, receipts: [], active: null, next: 'reinforcement' };
      else if (path === '/api/study-plan/diagnostic') json = { mode: 'coach', session: null };
      else if (path === '/api/study-plan/reinforcement') json = { mode: 'coach', task: null, next: null, session: null, attempts: [], completed: [], due: [] };
      else if (path === '/api/review/due') json = { owner: 'fixture', asOf: '2026-09-25', dueNow: 12, dueToday: 18, upcoming7Days: 36, queue: [] };
      else if (path === '/api/stats/chapter-frequency') json = { rows: [] };
      else if (path === '/api/admin/status') json = { isAdmin: false };
      return route.fulfill({ json });
    });
    await page.goto(`${base}/${scenario}`);
    await page.getByRole('heading', { level: 1 }).waitFor();
    if (scenario === 'review') await page.getByRole('button', { name: '開始到期複習', exact: true }).waitFor();
    if (scenario === 'study-plan') await page.getByRole('link', { name: '繼續今日任務', exact: true }).waitFor();
    if (scenario === 'analysis') await page.getByText('你的整體掌握度', { exact: true }).waitFor().catch(async error => { console.log(await page.locator('body').innerText(), errors); throw error; });
    for (const width of [320, 375, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${scenario}: overflow ${width}`);
      if (phase === 'after') assert(await page.locator('main').evaluate(e => parseFloat(getComputedStyle(e).paddingLeft) >= 16), `${scenario}: page padding ${width}`);
      await page.screenshot({ path: `${out}/${scenario}-${width}.png`, fullPage: true });
      await page.screenshot({ path: `${out}/${scenario}-${width}-viewport.png` });
    }
    if (phase === 'after') {
      await page.setViewportSize({ width: 375, height: 900 });
      for (const control of await page.locator('main .study-button, main select, main summary').all()) {
        if (await control.isVisible()) assert((await control.boundingBox()).height >= 44, `${scenario}: small touch target`);
      }
      const first = page.locator('main a, main button:not(:disabled), main select, main summary').first();
      await first.focus();
      for (let i = 0; i < 12; i++) {
        const focus = await page.evaluate(() => { const e = document.activeElement; return { inside: !!e.closest('main'), outline: getComputedStyle(e).outlineStyle }; });
        if (!focus.inside) break;
        assert.notEqual(focus.outline, 'none', `${scenario}: missing keyboard focus`);
        await page.keyboard.press('Tab');
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert(await page.locator('main').evaluate(e => [...e.querySelectorAll('*')].every(n => getComputedStyle(n).animationName === 'none')));
      if (scenario === 'study-plan') {
        const progress = page.getByRole('progressbar', { name: '今日任務完成百分比' });
        assert.equal(await progress.getAttribute('aria-valuenow'), '40');
        assert((await progress.boundingBox()).height >= 6, 'progress track stays visible');
        assert((await progress.locator('span').boundingBox()).width > 0, 'progress fill stays visible');
        const summary = page.locator('main summary').first();
        await summary.focus(); await page.keyboard.press('Enter');
        assert(await summary.evaluate(e => e.parentElement.open), 'keyboard opens native disclosure');
        await page.keyboard.press('Enter');
        assert(!(await summary.evaluate(e => e.parentElement.open)), 'keyboard closes native disclosure');
      }
      if (scenario === 'analysis') {
        const filter = page.getByRole('button', { name: '最近 10 年', exact: true });
        await filter.focus(); await page.keyboard.press('Enter');
        assert.equal(await filter.getAttribute('aria-pressed'), 'true');
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${phase} ${scenario}: seven widths, screenshots${phase === 'after' ? ', keyboard and reduced motion' : ''}`);
  }
} finally { await browser.close(); }
