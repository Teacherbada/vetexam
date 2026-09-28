import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'http://localhost:3267';
const profile = await mkdtemp(join(tmpdir(), 'vetexam-auth-test-'));
const user = { id: 'fixture', name: 'Auth Fixture', email: 'fixture@example.test', emailVerified: true };
const session = { user, session: { id: 'fixture', userId: user.id, expiresAt: new Date(Date.now() + 86400000).toISOString() } };
let mode = 'normal', releaseSession;
let context;
let sessionRequests = 0;
const errors = [];
async function open() {
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  for (const page of context.pages()) page.on('pageerror', error => errors.push(error.message));
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    let json = {};
    if (path === '/api/auth/sign-in/email') return route.fulfill({ json: { user, redirect: false }, headers: { 'Set-Cookie': 'auth_fixture=present; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400' } });
    if (path === '/api/auth/get-session') {
      sessionRequests++;
      if (mode === 'slow') await new Promise(resolve => { releaseSession = resolve; });
      if (mode === 'failed') return route.fulfill({ status: 503, json: { message: 'unavailable' } });
      json = (await request.allHeaders()).cookie?.includes('auth_fixture=present') ? session : null;
    } else if (path === '/api/admin/status') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    else if (path === '/api/subscription') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    else if (path === '/api/learning') json = request.method() === 'GET' ? { owner: user.id, progress: {}, favorites: [], wrongQuestions: [], history: [], legacy: [] } : { success: true };
    else if (path === '/api/learning/summary') json = { owner: user.id, progress: {}, todayCompleted: 0, todayDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date()) };
    else if (path === '/api/quiz') json = new URL(request.url()).searchParams.has('settings') ? { availability: [], chapterAvailability: [] } : { questions: [] };
    else if (path === '/api/stats/weekly-most-missed') json = { question: null, source: null };
    else if (path === '/api/stats/chapter-frequency') json = { rows: [] };
    return route.fulfill({ json });
  });
  return context.pages()[0];
}
try {
  let page = await open();
  mode = 'slow';
  await page.goto(base);
  await page.getByText('讀取帳號中…', { exact: true }).waitFor();
  assert.equal(await page.locator('.study-account a[href="/login"]').count(), 0);
  mode = 'normal'; releaseSession();
  await page.locator('.study-account a[href="/login"]').waitFor();
  await page.goto(base + '/login');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('密碼', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await page.locator('.study-account-menu summary').filter({ hasText: user.name }).waitFor();
  await page.reload();
  await page.locator('.study-account-menu summary').filter({ hasText: user.name }).waitFor();
  const savedCookies = await context.cookies();
  await context.close();
  page = await open();
  const persisted = (await context.cookies()).some(cookie => cookie.name === 'auth_fixture');
  // Report whether this test profile retained its cookie on relaunch.
  // Restoring a fixture is not a persistence test pass.
  if (!persisted) await context.addCookies(savedCookies);
  for (const path of ['/', '/subjects', '/questions', '/favorites', '/wrong', '/analysis']) {
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/auth/get-session') && response.status() === 200);
    await page.goto(base + path);
    assert.equal((await (await responsePromise).json()).user.id, user.id);
    assert.ok((await context.cookies()).some(cookie => cookie.name === 'auth_fixture'));
  }
  mode = 'failed'; await page.goto(base);
  await page.getByText('暫時無法讀取帳號', { exact: true }).waitFor();
  assert.equal(await page.locator('.study-account a[href="/login"]').count(), 0);
  mode = 'normal'; await page.getByRole('button', { name: '重試', exact: true }).click();
  await page.locator('.study-account-menu summary').filter({ hasText: user.name }).waitFor();
  mode = 'slow'; await page.goto(base);
  await page.getByText('讀取帳號中…', { exact: true }).waitFor();
  await page.getByText('讀取帳號逾時，請重試', { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await page.locator('.study-account a[href="/login"]').count(), 0);
  mode = 'normal'; releaseSession();
  await page.getByRole('button', { name: '重試', exact: true }).click();
  await page.locator('.study-account-menu summary').filter({ hasText: user.name }).waitFor();
  await page.addInitScript(() => {
    Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true });
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); }, configurable: true });
  });
  await page.reload();
  await page.locator('.study-account-menu summary').filter({ hasText: user.name }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: await context.browser().version(), platform: process.platform, nativeProfileCookiePersistence: persisted, restoredFixtureCookies: !persisted, passed: ['loading vs anonymous', 'fixture sign-in', 'refresh', 'six page session requests', '503 error and retry', 'hung session deadline and retry', 'admin/subscription 503 leaves account intact', 'storage blocked and missing timeout API'], sessionRequests }));
} catch (error) {
  console.error({ pageErrors: errors });
  throw error;
} finally { await context?.close(); }
