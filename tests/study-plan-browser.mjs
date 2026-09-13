import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let mode = null, status = 200, failSave = false;
  await page.route('**/api/study-plan', route => {
    if (route.request().method() === 'PUT') {
      if (failSave) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      mode = route.request().postDataJSON().mode;
    }
    return route.fulfill({ status, json: { mode } });
  });
  const url = (process.env.TEST_BASE_URL || 'http://localhost:3127') + '/study-plan';
  await page.goto(url);
  await page.getByText('先選擇你的學習模式', { exact: true }).waitFor();
  await page.getByRole('button', { name: '交給 VetExam 安排', exact: true }).click();
  await page.getByText('目前模式：國考教練模式', { exact: true }).waitFor();
  failSave = true;
  await page.getByRole('button', { name: '自己安排進度', exact: true }).click();
  await page.getByText('暫時無法確認儲存結果，請重試。原有學習紀錄不受影響。', { exact: true }).waitFor();
  assert.equal(mode, 'coach');
  failSave = false;
  await page.getByRole('button', { name: '自己安排進度', exact: true }).click();
  await page.getByText('目前模式：自訂進度模式', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('目前模式：自訂進度模式', { exact: true }).waitFor();
  await mkdir('.tmp/study-plan-artifacts', { recursive: true });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow at ' + width);
    if (width === 375) await page.screenshot({ path: '.tmp/study-plan-artifacts/mode-375.png', fullPage: true });
  }
  status = 503; await page.reload();
  await page.getByRole('button', { name: '重新載入' }).waitFor();
  status = 200; await page.getByRole('button', { name: '重新載入' }).click();
  await page.getByText('目前模式：自訂進度模式', { exact: true }).waitFor();
  status = 401; await page.reload();
  await page.getByRole('link', { name: '登入帳號' }).waitFor();
  assert(await page.getByRole('button', { name: '交給 VetExam 安排', exact: true }).isDisabled());
  assert.deepEqual(errors, []);
  console.log('Study plan UI fixtures passed: save, switch, reload, errors, guest and responsive widths.');
} finally { await browser.close(); }
