import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.TEST_BASE_URL || 'http://localhost:3320';
if (!/^http:\/\/(localhost|127\.0\.0\.1):/.test(base)) throw Error('Local fixture server required');
// A tiny real eight-page PDF for the native viewer, independent of mocked parsing.
function pdfFixture() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [' + Array.from({ length: 8 }, (_, i) => `${4 + i * 2} 0 R`).join(' ') + '] /Count 8 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (let i = 0; i < 8; i++) {
    const content = `BT /F1 18 Tf 40 720 Td (Original PDF page ${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  return Buffer.from(pdf + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const question = (id, extra = {}) => ({ id, questionNumber: id, subject: '獸醫病理學', question: `第 ${id} 題請選擇正確敘述。`, options: ['甲', '乙', '丙', '丁'], answer: 'A', explanation: '', pageNumber: 1, hasImage: false, confidence: 100, warnings: [], ...extra });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
mkdirSync('.tmp/pdf-workbench', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.pdfBlobs = { created: [], revoked: [] };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); if (blob.type === 'application/pdf') window.pdfBlobs.created.push(url); return url; };
    URL.revokeObjectURL = url => { window.pdfBlobs.revoked.push(url); revoke(url); };
  });
  let parseCalls = 0, imageCalls = 0, aiCalls = 0, large = false;
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/auth/get-session**', route => route.fulfill({ json: { user: { id: 'fixture', email: 'fixture@example.test' }, session: { id: 'fixture', userId: 'fixture' } } }));
  await page.route('**/api/admin/status', route => route.fulfill({ json: { isAdmin: true } }));
  await page.route('**/api/subscription', route => route.fulfill({ json: { subscription: { plan: 'pro', status: 'active' } } }));
  await page.route('**/api/question-sets', route => route.fulfill({ json: { questionSets: [] } }));
  await page.route('**/api/admin/questions/classify', route => { aiCalls++; return route.fulfill({ json: {} }); });
  await page.route('**/api/pdf', route => { parseCalls++; return route.fulfill({ json: { fileHash: 'a'.repeat(64), questions: large ? Array.from({ length: 200 }, (_, i) => question(i + 1, { answer: i % 5 === 0 ? '' : 'A', hasImage: i % 7 === 0 })) : [
    question(1), question(2, { answer: '', confidence: 80, warnings: ['沒答案'] }),
    question(3, { options: ['甲', '乙', '', '丁'], confidence: 75, warnings: ['缺選項'] }),
    question(4, { options: ['甲', '乙', '丙', '丁', '戊'], answer: 'E', hasImage: true, pageNumber: 7 }),
    question(5, { warnings: ['跨頁'], pageNumber: 7, endPage: 8, confidence: 95 }),
    question(6, { pageNumber: undefined }),
  ] } }); });
  await page.route('**/api/pdf/images-v10', route => { imageCalls++; return route.fulfill({ json: { imageDataUrl: png, imageDataUrls: [png] } }); });
  await page.goto(base + '/pdf');
  await page.locator('#exam-subject').selectOption('獸醫病理學');
  await page.locator('#exam-year').selectOption({ index: 1 });
  await page.getByLabel('選擇國考 PDF 檔案').setInputFiles({ name: 'workbench.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  const start = performance.now();
  await page.getByRole('button', { name: '開始解析 PDF', exact: true }).click();
  const workbench = page.getByRole('region', { name: '快速檢查工作台', exact: true });
  await workbench.getByRole('table').waitFor();
  const reviewReadyMs = Math.round(performance.now() - start);
  assert.equal(await workbench.getByRole('row').count(), 4);
  assert.equal(await workbench.getByRole('button', { name: '需要確認', exact: true }).getAttribute('aria-pressed'), 'true');
  for (const [label, count] of [['全部題目數', '6'], ['自動檢查通過', '3'], ['需要人工確認', '3'], ['明顯異常', '1'], ['圖片候選', '1']]) assert.equal(await workbench.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd').innerText(), count);
  assert.equal(await workbench.locator('iframe').count(), 0);
  assert.equal(imageCalls, 0); assert.equal(parseCalls, 1);
  await workbench.getByRole('button', { name: '對照第 2 題原 PDF', exact: true }).click();
  await workbench.locator('iframe[src$="#page=1"]').waitFor();
  assert.match(await workbench.getByRole('region', { name: '第 2 題 PDF 對照' }).innerText(), /沒答案/);
  await workbench.getByRole('button', { name: '標記已人工確認', exact: true }).click();
  assert.equal(await workbench.getByRole('row').count(), 3);
  await workbench.getByRole('button', { name: '已確認', exact: true }).click();
  assert.equal(await workbench.getByRole('row').count(), 2);
  await workbench.getByRole('button', { name: '展開完整編輯', exact: true }).click();
  const editor2 = page.locator('#pdf-question-2');
  assert.equal(await editor2.getAttribute('open'), '');
  assert.equal(await page.evaluate(() => document.activeElement?.parentElement?.id), 'pdf-question-2');
  await editor2.getByLabel('第 2 題題目', { exact: true }).fill('修改後必須重新確認的題幹');
  await workbench.getByText('此篩選下沒有題目。可切換「全部」繼續抽查。').waitFor();
  await workbench.getByRole('button', { name: '圖片題', exact: true }).click();
  assert.equal(await workbench.getByRole('row').count(), 2);
  await workbench.getByRole('button', { name: '對照第 4 題原 PDF', exact: true }).click();
  await workbench.locator('iframe[src$="#page=7"]').waitFor();
  assert.match(await workbench.getByRole('region', { name: '第 4 題 PDF 對照' }).innerText(), /E\. 戊/);
  assert.equal(await workbench.getByRole('link', { name: '在新分頁開啟原 PDF' }).getAttribute('href'), await workbench.locator('iframe').getAttribute('src'));
  assert.equal(imageCalls, 0, 'comparison does not extract candidate images');
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflow ' + width);
    await workbench.screenshot({ path: `.tmp/pdf-workbench/compare-${width}.png` });
  }
  await workbench.getByRole('button', { name: '全部', exact: true }).click();
  await workbench.getByRole('button', { name: '對照第 5 題原 PDF', exact: true }).click();
  await workbench.getByText('此題跨至第 8 頁，請一併檢查後續頁面。').waitFor();
  await workbench.getByRole('button', { name: '對照第 6 題原 PDF', exact: true }).click();
  assert.equal(await workbench.locator('iframe').count(), 0);
  assert.match(await workbench.innerText(), /沒有來源頁碼/);
  await workbench.getByRole('button', { name: '對照第 4 題原 PDF', exact: true }).click();
  await workbench.getByRole('button', { name: '展開完整編輯', exact: true }).click();
  const editor4 = page.locator('#pdf-question-4');
  await editor4.getByRole('button', { name: '移除圖片 1', exact: true }).waitFor();
  assert.equal(imageCalls, 1);
  await editor4.locator('input[type="file"]').setInputFiles({ name: 'manual.png', mimeType: 'image/png', buffer: Buffer.from(png.split(',')[1], 'base64') });
  await editor4.getByRole('button', { name: '移除圖片 2', exact: true }).waitFor();
  await editor4.getByRole('button', { name: '移除圖片', exact: true }).click();
  assert.equal(await editor4.getByRole('img').count(), 0);
  await workbench.getByRole('button', { name: '圖片題', exact: true }).click();
  await workbench.getByText('此篩選下沒有題目。可切換「全部」繼續抽查。').waitFor();
  await page.getByRole('button', { name: '返回修改', exact: true }).click();
  const blobs = await page.evaluate(() => window.pdfBlobs);
  assert(blobs.created.length > 0 && blobs.created.every(url => blobs.revoked.includes(url)), 'all original PDF object URLs released');
  assert.equal(parseCalls, 1); assert.equal(imageCalls, 1); assert.equal(aiCalls, 0); assert.deepEqual(errors, []);
  large = true;
  const largeStart = performance.now();
  await page.getByRole('button', { name: '開始解析 PDF', exact: true }).click();
  await workbench.getByText('顯示 40 / 200 題', { exact: true }).waitFor();
  const largeReviewReadyMs = Math.round(performance.now() - largeStart);
  assert.equal(await workbench.locator('iframe').count(), 0);
  await workbench.getByRole('button', { name: '全部', exact: true }).click();
  assert.equal(await workbench.getByRole('row').count(), 201);
  assert.equal(imageCalls, 1, '200-question overview adds no image requests');
  assert.equal(parseCalls, 2, 'one parse per explicitly submitted PDF');
  assert.deepEqual(errors, []);
  const result = { reviewReadyMs, largeReviewReadyMs, largeQuestionCount: 200, parseCalls, imageCallsBeforeEditor: 0, imageCallsAfterEditor: imageCalls, aiCalls, widths: [320, 375, 768, 1280], checks: 'filters/counts/status/E/page1/page7/missing page/cross-page/manual confirmation/edit invalidation/accordion focus/manual upload/remove/blob cleanup/200-question overview', environment: 'local mocked APIs; browser native viewer uses real PDF fixture' };
  writeFileSync('.tmp/pdf-workbench/result.json', JSON.stringify(result, null, 2)); console.log('PASS', JSON.stringify(result));
} finally { await browser.close(); }
