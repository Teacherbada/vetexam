import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3128';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const subjects = ['獸醫病理學', '獸醫藥理學', '獸醫實驗診斷學', '獸醫普通疾病學', '獸醫傳染病學', '獸醫公共衛生學'];
await mkdir('.tmp/diagnostic-artifacts', { recursive: true });
try {
  for (const role of ['guest', 'user', 'admin']) {
    const page = await browser.newPage();
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      const json = path === '/api/auth/get-session' ? role === 'guest' ? null : { user: { id: role, name: '測試帳號', email: 'fixture@example.com' }, session: { id: 'fixture' } }
        : path === '/api/admin/status' ? { isAdmin: role === 'admin' }
        : path === '/api/quiz' ? { availability: [], chapterAvailability: [] }
        : { question: null };
      return route.fulfill({ json });
    });
    await page.goto(base);
    await page.locator(role === 'guest' ? '.study-register' : '.study-account-menu').waitFor();
    for (const width of [320, 375, 768, 1200, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `home ${role} overflow ${width}`);
      const nav = page.locator(width < 1200 ? '.study-mobile-nav nav' : '.study-desktop-nav');
      if (width < 1200) await page.locator('.study-mobile-nav').evaluate(el => { el.open = true; });
      const plan = nav.getByRole('link', { name: '設定學習計畫', exact: true });
      await plan.waitFor();
      if (role === 'admin') {
        const pdf = nav.getByRole('link', { name: '國考解析', exact: true });
        await pdf.waitFor();
        const layout = await plan.evaluate(el => {
          const a = el.getBoundingClientRect(), prev = el.previousElementSibling, b = prev.getBoundingClientRect();
          const style = getComputedStyle(el), other = getComputedStyle(prev);
          return { prev: prev.getAttribute('href'), y: a.y, py: b.y, h: a.height, ph: b.height, font: style.fontSize, pfont: other.fontSize, radius: style.borderRadius, pradius: other.borderRadius };
        });
        assert.equal(layout.prev, '/pdf'); assert.equal(layout.font, layout.pfont); assert.equal(layout.radius, layout.pradius);
        if (width >= 1200) { assert(Math.abs(layout.y - layout.py) < 1); assert.equal(layout.h, layout.ph); }
      } else assert.equal(await nav.locator('a[href="/pdf"]').count(), 0);
      assert.equal(await page.locator('.study-hero a[href="/study-plan"]').count(), 0);
      if (width === 375 || width === 1280) await page.screenshot({ path: `.tmp/diagnostic-artifacts/home-${role}-${width}.png`, fullPage: true });
    }
    await page.close();
  }

  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let session = null, fail = false, guest = false;
  const makeView = () => ({ mode: 'coach', session });
  const current = position => ({ position, questionId: position, subject: subjects[position - 1], chapter: null, question: '診斷題目 ' + position, options: ['選項甲', '選項乙', '', '', '選項戊'], image: null });
  await page.route('**/api/study-plan', route => route.fulfill({ json: { mode: 'coach' } }));
  await page.route('**/api/study-plan/diagnostic', route => {
    if (guest) return route.fulfill({ status: 401, json: { error: 'login' } });
    if (fail) return route.fulfill({ status: 503, json: { error: '診斷暫時無法連線。請重新載入確認已儲存進度。' } });
    if (route.request().method() === 'POST' && !session) session = { id: '11111111-1111-1111-1111-111111111111', total: 6, answered: 0, completed: false,
      shortages: subjects.map(subject => ({ subject, available: 1 })), results: [], current: current(1) };
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      assert.equal(body.position, session.answered + 1);
      session.answered++;
      session.completed = session.answered === session.total;
      session.current = session.completed ? null : current(session.answered + 1);
      if (session.completed) session.results = subjects.map(subject => ({ subject, total: 1, answered: 1, correct: 1, insufficient: true, suspect: false }));
    }
    return route.fulfill({ json: makeView() });
  });
  await page.goto(base + '/study-plan');
  await page.getByRole('heading', { name: '先讓 VetExam 了解你' }).waitFor();
  await page.getByRole('link', { name: '開始診斷', exact: true }).click();
  await page.getByRole('button', { name: '開始診斷', exact: true }).click();
  await page.getByText('已儲存 0 / 6 題', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'E 選項戊', exact: true }).click();
  fail = true;
  await page.getByRole('button', { name: '送出並繼續', exact: true }).click();
  await page.getByText('診斷暫時無法連線。請重新載入確認已儲存進度。', { exact: true }).waitFor();
  assert.equal(session.answered, 0);
  fail = false;
  await page.getByRole('button', { name: '送出並繼續', exact: true }).click();
  await page.getByText('已儲存 1 / 6 題', { exact: true }).waitFor();
  await page.goto(base + '/study-plan');
  await page.getByRole('link', { name: '繼續診斷', exact: true }).click();
  await page.getByRole('heading', { name: '診斷題目 2', exact: true }).waitFor();
  await page.reload();
  await page.getByText('已儲存 1 / 6 題', { exact: true }).waitFor();
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'diagnostic overflow ' + width);
    if (width === 375) await page.screenshot({ path: '.tmp/diagnostic-artifacts/diagnostic-375.png', fullPage: true });
  }
  for (let n = 1; n < 6; n++) {
    await page.getByRole('button', { name: 'E 選項戊', exact: true }).click();
    await page.getByRole('button', { name: n === 5 ? '送出並完成診斷' : '送出並繼續', exact: true }).click();
    await page.getByText(`已儲存 ${n + 1} / 6 題`, { exact: true }).waitFor();
  }
  await page.getByRole('heading', { name: '初步診斷完成', exact: true }).waitFor();
  assert.equal(await page.getByText('資料不足，暫不判定', { exact: true }).count(), 6);
  assert(await page.getByRole('button', { name: '繼續弱點確認', exact: true }).isDisabled());
  await page.reload();
  await page.getByRole('heading', { name: '初步診斷完成', exact: true }).waitFor();
  guest = true; await page.reload();
  await page.getByRole('link', { name: '登入帳號', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS homepage guest/user/admin visibility/alignment, 6 widths; diagnostic start, answer, retry, resume, reload, completion, insufficient data and guest UI');
} finally { await browser.close(); }
