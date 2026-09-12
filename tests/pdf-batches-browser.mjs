import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const base = process.env.TEST_BASE_URL || "http://localhost:3200";
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  let large = true, failSecond = true, parseCalls = 0, normalCalls = 0;
  const batches = [];
  const questions = () => Array.from({ length: 4 }, (_, i) => ({ id: i + 1, subject: "獸醫公共衛生學", question: `題目 ${i + 1}`, options: ["甲", "乙", "丙", "丁", "戊"], answer: "A", explanation: "解析", hasImage: true, imageSource: "manual", imageDataUrl: png + (large ? "A".repeat(1_100_000) : "") }));
  await page.route("**/api/auth/get-session**", (route) => route.fulfill({ json: { user: { id: "fixture", name: "Fixture", email: "fixture@example.test", emailVerified: true }, session: { id: "fixture", userId: "fixture", expiresAt: new Date(Date.now() + 86400000).toISOString() } } }));
  await page.route("**/api/admin/status", (route) => route.fulfill({ json: { isAdmin: true } }));
  await page.route("**/api/subscription", (route) => route.fulfill({ json: { subscription: { plan: "pro", status: "active" } } }));
  await page.route("**/api/question-sets", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: { questionSets: [] } });
    else { normalCalls++; await route.fulfill({ status: 413, contentType: "text/plain", body: "Request Entity Too Large" }); }
  });
  await page.route("**/api/pdf", (route) => { parseCalls++; return route.fulfill({ json: { questions: questions(), fileHash: "a".repeat(64), detectedOptionCount: 5 } }); });
  await page.route("**/api/question-sets/batch", async (route) => {
    const body = route.request().postDataJSON();
    assert(Buffer.byteLength(route.request().postData()) < 4_000_000);
    batches.push(body);
    if (body.batchIndex === 1 && failSecond) { failSecond = false; await route.fulfill({ status: 500, json: { error: "模擬暫時失敗" } }); }
    else await route.fulfill({ json: body.batchIndex === 1 ? { complete: true, questionSetId: 123 } : { complete: false } });
  });
  const parse = async () => {
    await page.goto(base + "/pdf");
    await page.locator("#exam-subject").selectOption("獸醫公共衛生學");
    await page.locator("#exam-year").selectOption({ index: 1 });
    await page.getByRole("button", { name: "公開・國考題庫", exact: true }).click();
    await page.getByLabel("選擇國考 PDF 檔案").setInputFiles({ name: "exam.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-fixture") });
    await page.getByRole("button", { name: "開始解析 PDF", exact: true }).click();
    await page.getByRole("heading", { name: "檢查解析結果" }).waitFor();
  };
  await parse();
  await page.getByRole("button", { name: "儲存至公開國考題庫", exact: true }).click();
  assert.equal(normalCalls, 0, "oversized normal save is blocked before network");
  assert(await page.getByRole("checkbox", { name: "分批匯入", exact: true }).isChecked());
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 812 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel("第 2 批起始題號").fill("2");
  assert(await page.getByRole("button", { name: "開始分批匯入", exact: true }).isDisabled());
  await page.getByLabel("第 2 批起始題號").fill("3");
  await page.getByRole("button", { name: "開始分批匯入", exact: true }).click();
  await page.getByRole("button", { name: "開始分批匯入", exact: true }).waitFor();
  assert.equal(batches.length, 2);
  assert.equal(await page.getByRole("textbox", { name: "第 4 題題目", exact: true }).inputValue(), "題目 4");
  assert((await page.locator("main").innerText()).includes("模擬暫時失敗"));
  await page.getByRole("button", { name: "開始分批匯入", exact: true }).click();
  await page.getByText("✅ 已確認匯入 4 題，全部題目已存入同一份題庫。", { exact: true }).waitFor();
  assert.equal(parseCalls, 1); assert.equal(batches.length, 4);
  assert(batches.every((batch) => batch.importId === batches[0].importId));
  assert.deepEqual(batches[0].questions.map((q) => q.question), ["題目 1", "題目 2"]);
  assert.deepEqual(batches[1].questions.map((q) => q.question), ["題目 3", "題目 4"]);
  assert.equal(await page.getByRole("heading", { name: "檢查解析結果" }).count(), 0);
  console.log("PASS one PDF upload, capacity preflight, mobile ranges, overlap blocked, sequential batches, retry keeps same import ID");
  large = false;
  await parse();
  await page.getByRole("button", { name: "儲存至公開國考題庫", exact: true }).click();
  await page.getByText(/儲存資料超過伺服器容量限制（HTTP 413）/).waitFor();
  assert(!(await page.locator("main").innerText()).includes("Unexpected token"));
  assert.equal(await page.getByRole("textbox", { name: "第 1 題題目", exact: true }).inputValue(), "題目 1");
  console.log("PASS plain-text 413 stays actionable and parsed questions remain available");
} finally { await browser.close(); }
