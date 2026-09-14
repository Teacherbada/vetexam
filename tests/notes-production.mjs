import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.TEST_BASE_URL || 'https://vetexam-tw.vercel.app';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  assert.equal((await page.goto(base + '/notes')).status(), 200);
  await page.getByRole('heading', { name: '學習筆記', exact: true }).waitFor();
  const list = await page.request.get(base + '/api/notes'); assert.equal(list.status(), 200);
  const body = await list.json(); assert(Array.isArray(body.notes));
  for (const note of body.notes) { assert.equal(note.visibility, 'public'); assert(['active','published'].includes(note.status)); assert(!Object.hasOwn(note, 'author_id')); assert(!Object.hasOwn(note, 'email')); }
  for (const tab of ['mine','favorites']) assert.equal((await page.request.get(`${base}/api/notes?tab=${tab}`)).status(), 401);
  const id = '00000000-0000-4000-8000-000000000000';
  for (const method of ['POST','PUT','PATCH','DELETE']) assert.equal((await page.request.fetch(`${base}/api/notes${method === 'POST' ? '' : '/' + id}`, { method, headers: { origin: base }, data: {} })).status(), 401);
  assert.equal((await page.request.get(base + '/api/notes/' + id)).status(), 404);
  for (const width of [320,375,768,1280]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow ' + width); }
  assert.equal((await page.goto(base + '/notes/new')).status(), 200); await page.getByRole('link', { name: '登入帳號', exact: true }).waitFor();
  assert.equal((await page.request.get(base + '/api/quiz?scope=public&settings=1&chapters=1')).status(), 200);
  assert.deepEqual(errors, []); console.log('PASS production notes list/public visibility/private guards/write guards/editor login/public quiz/four widths/no page errors');
} finally { await browser.close(); }
