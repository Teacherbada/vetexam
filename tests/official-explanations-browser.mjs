// Real UI + real route/service SQL against in-memory PostgreSQL. All browser API
// requests are intercepted; the Next process receives only a dummy database URL.
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink, rmdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { fixture, service } from './helpers/official-explanation-fixture.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const f = await fixture();
const dir = new URL('../app/official-explanation-test-fixture/', import.meta.url);
const artifacts = new URL('../.tmp/official-explanation-artifacts/', import.meta.url);
const base = 'http://127.0.0.1:3127';
let created = false, server, browser, page, log = '';
const text = '| 名詞 | 說明 |\n| --- | --- |\n| PK | pharmacokinetics |\n\n### 核心考點\n\n**正確答案：C**\n中文與 pharmacokinetics\n第二行\n\n- 重點一\n- 重點二\n\n1. 順序一\n2. 順序二\n\n[參考資料](https://example.test/reference)\n\nhttps://example.test/direct\n\n' + '長篇中文醫學說明。'.repeat(40);
try {
  await mkdir(dir); created = true;
  await writeFile(new URL('page.tsx', dir), `import Admin from '../admin/questions/QuestionsAdmin';
import Detail from '../questions/[id]/QuestionDetail';
export default async function Page({searchParams}:{searchParams:Promise<{mode?:string}>}) {
  return (await searchParams).mode==='detail' ? <Detail shareUrl={null} question={{id:1,questionSetId:1,questionNumber:1,subject:'獸醫病理學',examYear:2026,question:'本機測試題目一',options:['選項甲','選項乙','選項丙','選項丁'],hasAnswer:true}}/> : <Admin/>;
}`);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '3127'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      DATABASE_URL: 'postgresql://unused@127.0.0.1:1/never_connect', BETTER_AUTH_SECRET: 'local-test-secret-at-least-32-characters', BETTER_AUTH_URL: base, NEXT_PUBLIC_SITE_URL: base },
  });
  server.stdout.on('data', chunk => { log = (log + chunk).slice(-12000); });
  server.stderr.on('data', chunk => { log = (log + chunk).slice(-12000); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/next.svg')).ok) { ready = true; break; } } catch {}
    if (server.exitCode !== null) throw Error(log);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert(ready, log);
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let writes = 0, failSave = false;
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/admin/questions' || path === '/api/admin/questions/explanation') {
      if (request.method() === 'PATCH') {
        writes++;
        await new Promise(resolve => setTimeout(resolve, 200));
        if (failSave) return route.fulfill({ status: 503, json: { error: '測試暫時儲存失敗' } });
      }
      const local = new Request(request.url(), { method: request.method(), headers: { ...request.headers(), 'x-fixture-user': 'fixture-admin' },
        ...(request.postData() ? { body: request.postData() } : {}) });
      const response = await (path.endsWith('/explanation') ? f.route : f.list)[request.method()](local);
      return route.fulfill({ status: response.status, json: await response.json() });
    }
    if (path === '/api/quiz') {
      assert.equal(url.searchParams.get('scope'), 'public');
      const rows = await f.sql.query("SELECT * FROM questions WHERE question_set_id=1 AND kind='exam' ORDER BY id", []);
      return route.fulfill({ json: { questions: rows.map(q => ({ id: q.id, questionSetId: 1, questionNumber: q.question_number, subject: q.subject, question: q.question,
        options: [q.option_a,q.option_b,q.option_c,q.option_d], answer: q.answer, explanation: q.explanation_status === 'published' ? q.explanation || '' : '', examYear: 2026, questionSetName: '測試國考題庫' })) } });
    }
    if (path === '/api/stats/answers') {
      return route.fulfill({ json: url.searchParams.has('reveal') ? { available: true, answer: 'C', correct: true, explanation: (await service.readExplanation(f.sql.query, 1)).status === 'published' ? (await service.readExplanation(f.sql.query, 1)).explanation : '' } : { available: true } });
    }
    if (path.startsWith('/api/auth/')) return route.fulfill({ json: null });
    if (path === '/api/admin/status') return route.fulfill({ json: { isAdmin: false } });
    return route.fulfill({ status: 401, json: { error: 'local fixture' } });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base + '/official-explanation-test-fixture');
  const open = async id => {
    await page.getByRole('row').filter({ hasText: `#${id}` }).getByRole('button', { name: '查看／編輯' }).click();
    await page.getByLabel('精選解析內容', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('textarea[rows="16"]')?.disabled);
  };
  await open(1);
  assert.equal(await page.getByLabel('精選解析內容', { exact: true }).inputValue(), '');
  await page.getByLabel('精選解析內容', { exact: true }).fill(text);
  const editor = page.getByRole('region', { name: '精選解析編輯', exact: true });
  await editor.getByRole('button', { name: '預覽', exact: true }).click();
  await editor.getByRole('heading', { name: '核心考點', exact: true }).waitFor();
  assert.equal(await editor.locator('strong').last().innerText(), '正確答案：C'); assert.equal(await editor.locator('table').count(), 1);
  assert.equal(await editor.locator('ul li').count(), 2); assert.equal(await editor.locator('ol li').count(), 2);
  assert.equal(await editor.getByRole('link', { name: '參考資料' }).getAttribute('href'), 'https://example.test/reference');
  const save = editor.getByRole('button', { name: '儲存草稿', exact: true });
  await save.evaluate(button => { button.click(); button.click(); });
  await editor.getByRole('status').filter({ hasText: '草稿已儲存' }).waitFor(); assert.equal(writes, 1);
  assert.equal((await service.readExplanation(f.sql.query, 1)).status, 'draft');
  const published = editor.getByRole('button', { name: '發布解析', exact: true });
  assert(await published.isDisabled());
  await editor.getByLabel(/我已人工核對/).check(); await published.click();
  await editor.getByRole('status').filter({ hasText: '已人工確認並發布解析' }).waitFor();
  assert.equal((await service.readExplanation(f.sql.query, 1)).status, 'published');
  await editor.getByRole('button', { name: '取消發布', exact: true }).click();
  await editor.getByRole('status').filter({ hasText: '已取消發布' }).waitFor();
  const hidden = await page.evaluate(async () => (await (await fetch('/api/quiz?scope=public')).json()).questions);
  assert.equal(hidden.find(q => q.id === 1).explanation, '');
  assert.equal((await service.readExplanation(f.sql.query, 1)).explanation, text);
  console.log('PASS admin initial add/preview/double submit');
  await page.reload(); await open(1);
  assert.equal(await page.getByLabel('精選解析內容', { exact: true }).inputValue(), text);
  await open(2);
  assert.equal(await page.getByLabel('精選解析內容', { exact: true }).inputValue(), '既有解析不能遺失');
  await page.getByLabel('精選解析內容', { exact: true }).fill('既有解析不能遺失\n\n補充段落');
  await save.click(); await editor.getByRole('status').filter({ hasText: '草稿已儲存' }).waitFor();
  await open(1);
  failSave = true;
  await page.getByLabel('精選解析內容', { exact: true }).fill(text + '\n尚未存入草稿');
  await save.click(); await editor.getByRole('alert').filter({ hasText: '測試暫時儲存失敗' }).waitFor();
  assert((await page.getByLabel('精選解析內容', { exact: true }).inputValue()).endsWith('尚未存入草稿'));
  failSave = false;
  const current = await service.readExplanation(f.sql.query, 1);
  await f.save({ id: current.id, revision: current.revision, action: 'draft', explanation: text + '\n另一視窗的修改' });
  await save.click(); await editor.getByRole('alert').filter({ hasText: '其他操作更新' }).waitFor();
  assert((await page.getByLabel('精選解析內容', { exact: true }).inputValue()).endsWith('尚未存入草稿'));
  await editor.getByRole('button', { name: '重新載入解析' }).click();
  await page.getByLabel('精選解析內容', { exact: true }).waitFor();
  assert((await page.getByLabel('精選解析內容', { exact: true }).inputValue()).endsWith('另一視窗的修改'));
  await editor.getByLabel(/我已人工核對/).check(); await published.click();
  await editor.getByRole('status').filter({ hasText: '已人工確認並發布解析' }).waitFor();
  await page.getByLabel('精選解析狀態', { exact: true }).selectOption('published');
  await page.getByRole('button', { name: '搜尋題目', exact: true }).click();
  await page.getByText(/共 1 題/).waitFor();
  await page.getByLabel('精選解析狀態', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: '搜尋題目', exact: true }).click();
  await page.getByText(/共 4 題/).waitFor();
  await mkdir(artifacts, { recursive: true });
  await editor.getByRole('button', { name: '預覽', exact: true }).click();
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'admin overflow ' + width);
    if (width === 375 || width === 1280) await editor.screenshot({ path: fileURLToPath(new URL(`admin-${width}.png`, artifacts)) });
  }
  await page.getByRole('button', { name: '關閉單題' }).click();
  await page.getByRole('row').filter({ hasText: '#3' }).getByRole('button', { name: '查看／編輯' }).click();
  assert.equal(await page.getByRole('region', { name: '精選解析編輯', exact: true }).count(), 0);
  for (const mode of ['practice', 'exam']) {
    await page.goto(base + `/questions?started=1&mode=${mode}`);
    await page.getByRole('heading', { name: '本機測試題目一', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '核心考點', exact: true }).count(), 0);
    await page.getByRole('group', { name: '答案選項' }).getByRole('button').nth(2).click();
    if (mode === 'exam') {
      assert.equal(await page.getByRole('heading', { name: '核心考點', exact: true }).count(), 0);
      await page.getByRole('button', { name: '交卷', exact: true }).click();
    }
    await page.getByRole('heading', { name: '核心考點', exact: true }).waitFor();
    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), mode + ' overflow ' + width);
      if (mode === 'practice' && [375,1280].includes(width)) await page.screenshot({ path: fileURLToPath(new URL(`practice-${width}.png`, artifacts)), fullPage: true });
    }
  }
  await page.goto(base + '/official-explanation-test-fixture?mode=detail');
  await page.getByRole('heading', { name: '本機測試題目一', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: '核心考點', exact: true }).count(), 0);
  await page.getByRole('group', { name: '答案選項' }).getByRole('button').nth(2).click();
  await page.getByRole('heading', { name: '核心考點', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS: admin add/edit/reload/preview/save/retry/conflict; private bank read-only; practice/exam/detail reveal; 320/375/768/1280 responsive; no browser errors.');
} catch (error) {
  if (page) console.error((await page.locator('body').innerText()).slice(-6000));
  console.error(log); throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { server.kill(); await new Promise(resolve => server.once('exit', resolve)); }
  await f.close();
  if (created) { await unlink(new URL('page.tsx', dir)); await rmdir(dir); }
  // Generated development route types must not keep a removed fixture alive.
  for (const path of ['../.next/dev/types/validator.ts', '../.next/dev/types/routes.d.ts']) {
    const url = new URL(path, import.meta.url);
    if ((await readFile(url, 'utf8').catch(() => '')).includes('official-explanation-test-fixture')) await unlink(url);
  }
}
