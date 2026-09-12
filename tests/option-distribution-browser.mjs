// UI fixtures never write test users, questions or answers into the database.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.TEST_BASE_URL || "http://localhost:3100";
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const question = { id: 101, questionSetId: 1, questionNumber: 12, subject: "獸醫病理學", question: "這是一道測試題目，請選出最適合的答案。", options: ["選項一", "選項二", "選項三", "選項四"], answer: "C", explanation: "這是官方解析，只有作答後才會顯示。", examYear: 2026, questionSetName: "測試題庫" };
const full = { total: 10, sufficient: true, min_attempts: 5, options: [
  { letter: "A", count: 3, percentage: 30 }, { letter: "B", count: 3, percentage: 30 },
  { letter: "C", count: 4, percentage: 40 }, { letter: "D", count: 0, percentage: 0 },
] };
const weekly = { question: { question_id: question.id, question_number: 12, exam_subject: question.subject, question: question.question, wrong_attempts: 6, total_attempts: 10 }, min_attempts: 10 };
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  let reads = 0, posts = [], distribution = full, offline = false, weeklyData = weekly;
  await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
  await page.route("**/api/admin/status", (route) => route.fulfill({ json: { isAdmin: false } }));
  await page.route("**/api/quiz?**", (route) => route.fulfill({ json: { questions: new URL(route.request().url()).searchParams.has("questionId") ? [question] : [question, { ...question, id: 102, questionNumber: 13 }] } }));
  await page.route("**/api/stats/weekly-most-missed", (route) => route.fulfill({ json: weeklyData }));
  await page.route("**/api/stats/answers", (route) => { posts.push(route.request().postDataJSON()); return route.fulfill({ json: { success: true, recorded: false } }); });
  await page.route("**/api/stats/option-distribution?**", (route) => { reads++; return route.fulfill({ status: offline ? 503 : 200, json: offline ? { error: "offline" } : distribution }); });
  const panel = () => page.locator("details").filter({ has: page.locator("summary", { hasText: "大家都選了什麼？" }) });
  const options = () => page.getByRole("group", { name: "答案選項", exact: true }).getByRole("button");
  const quiz = (mode) => base + "/questions?" + new URLSearchParams({ started: "1", mode, groups: JSON.stringify([{ subject: question.subject, count: "2", years: [] }]) });

  await page.goto(quiz("practice")); await options().first().waitFor();
  assert.equal(await panel().count(), 0); assert.equal(reads, 0);
  await options().nth(1).click();
  await page.getByRole("region", { name: "答案與解析" }).waitFor();
  await panel().locator("summary").click();
  await page.getByText("最常誤選：A、B", { exact: true }).waitFor();
  assert.equal(await panel().getByRole("progressbar").count(), 4);
  assert((await panel().innerText()).includes("你的答案"));
  assert((await panel().innerText()).includes("正確答案"));
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `practice overflow ${width}`);
  }
  await page.getByRole("button", { name: "下一題", exact: true }).click();
  assert.equal(await panel().count(), 0);
  offline = true;
  await options().first().click(); await panel().locator("summary").click();
  await page.getByText("暫時無法取得作答分布。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "完成測驗", exact: true }).click();
  await page.getByRole("heading", { name: "題目回顧" }).waitFor();
  assert.equal(await panel().count(), 2);
  console.log("PASS practice gating, ties, labels, four viewport sizes and API failure never blocks next/results");

  offline = false; posts = []; reads = 0;
  await page.goto(quiz("exam")); await options().first().click(); await options().nth(1).click();
  assert.equal(reads, 0); assert.equal(posts.length, 0); assert.equal(await panel().count(), 0);
  await page.getByRole("button", { name: "交卷", exact: true }).click();
  await page.getByRole("heading", { name: "題目回顧" }).waitFor();
  await panel().first().locator("summary").click();
  await page.getByText("最常誤選：A、B", { exact: true }).waitFor();
  assert.equal(posts.length, 1); assert.equal(posts[0].answers.length, 1); assert.equal(posts[0].answers[0].selected_answer, "B");
  console.log("PASS exam never requests distribution before submission; review loads it only when expanded");

  distribution = { total: 4, sufficient: false, min_attempts: 5, options: [] };
  await page.goto(quiz("practice")); await options().first().click(); await panel().locator("summary").click();
  await page.getByText("選項統計資料正在累積中。", { exact: false }).waitFor();
  assert.equal(await panel().getByRole("progressbar").count(), 0);
  assert(!(await panel().innerText()).includes("%"));
  console.log("PASS fewer than five samples show no percentages");

  distribution = full; reads = 0;
  await page.goto(base); await page.getByRole("button", { name: "挑戰這題", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "本週魔王題" });
  await dialog.getByRole("group", { name: "本週魔王題答案選項" }).waitFor();
  assert.equal(await panel().count(), 0); assert.equal(reads, 0);
  await dialog.getByRole("group", { name: "本週魔王題答案選項" }).getByRole("button").nth(1).click();
  await dialog.getByText("最常誤選：A、B", { exact: true }).waitFor();
  const artifacts = process.env.TEST_ARTIFACT_DIR;
  if (artifacts) await mkdir(artifacts, { recursive: true });
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    assert(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth), `dialog overflow ${width}`);
    if (artifacts && width === 375) await page.screenshot({ path: `${artifacts}/weekly-answer-mobile.png`, fullPage: true });
  }
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "挑戰這題");
  if (artifacts) await page.screenshot({ path: `${artifacts}/weekly-home-desktop.png`, fullPage: true });
  weeklyData = { question: null, min_attempts: 10 };
  await page.reload(); await page.getByText("本週作答資料累積中", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "挑戰這題", exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS homepage dialog answer distribution, mobile sizing, Escape/focus restoration and empty state; no browser errors");
} finally { await browser.close(); }
