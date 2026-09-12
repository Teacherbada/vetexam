// Run against a production build. PLAYWRIGHT_MODULE may point to a temporary
// Playwright installation so the application needs no new runtime dependency.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.TEST_BASE_URL || "http://localhost:3100";
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  const availability = await (await page.request.get(base + "/api/quiz?scope=public&settings=1")).json();
  const source = availability.availability.find((item) => Number(item.count) >= 2);
  assert(source, "Browser test requires a public subject with at least two questions");
  const groups = JSON.stringify([{ subject: source.subject, years: [], count: "2" }]);
  const questions = (await (await page.request.get(base + "/api/quiz?" + new URLSearchParams({ scope: "public", groups }))).json()).questions;
  const publicRank = await page.request.get(base + "/api/stats/most-missed?range=7d");
  assert.equal(publicRank.status(), 200);
  const rankData = await publicRank.json();
  assert.equal(rankData.min_attempts, 10);
  for (const item of rankData.questions) for (const key of ["answer", "explanation", "user_id", "email", "name"]) assert(!(key in item));
  const guest = await page.request.post(base + "/api/stats/answers", { data: { answers: [{ question_id: questions[0].id, selected_answer: "A" }] } });
  assert.deepEqual(await guest.json(), { success: true, recorded: false });
  await page.goto(base + "/subjects");
  await page.getByRole("button", { name: `選擇${source.subject}，設定練習`, exact: true }).click();
  const roc = source.year >= 1912 ? source.year - 1911 : source.year;
  const western = source.year >= 1912 ? source.year : source.year + 1911;
  await page.getByRole("button", { name: `民國 ${roc} 年（西元 ${western}）`, exact: true }).waitFor();
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 812 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  console.log("PASS real leaderboard API, guest skipped, ROC-first settings and mobile widths");
  await page.setViewportSize({ width: 375, height: 812 });

  let posts = [], offline = false;
  await page.route("**/api/stats/answers", async (route) => {
    posts.push(route.request().postDataJSON());
    await route.fulfill({ status: offline ? 503 : 200, json: offline ? { error: "offline" } : { success: true } });
  });
  const quizUrl = (mode, count = "2") => base + "/questions?" + new URLSearchParams({ groups: JSON.stringify([{ subject: source.subject, years: [], count }]), started: "1", mode, order: "original" });
  await page.goto(quizUrl("exam"));
  const options = () => page.getByRole("group", { name: "答案選項" }).getByRole("button");
  await options().first().click();
  await options().nth(1).click();
  assert.equal(posts.length, 0, "exam edits must not send statistics");
  assert.equal(await page.getByRole("region", { name: "答案與解析" }).count(), 0);
  await page.getByRole("button", { name: "交卷", exact: true }).click();
  await page.getByRole("heading", { name: "題目回顧" }).waitFor();
  await page.waitForFunction(() => document.body.innerText.includes("未作答 1 題"));
  await page.waitForTimeout(100);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0], { answers: [{ question_id: questions[0].id, selected_answer: "B" }] });
  console.log("PASS exam batches only final choices on submit, unanswered excluded, no correctness sent");

  posts = []; offline = true;
  await page.goto(quizUrl("practice"));
  await options().first().waitFor();
  await page.evaluate(() => {
    localStorage.setItem("wrongQuestions", JSON.stringify([{ id: -1, note: "preserve" }]));
    localStorage.setItem("favorites", JSON.stringify([{ id: -2 }]));
  });
  const wrongIndex = questions[0].answer === "A" ? 1 : 0;
  await options().nth(wrongIndex).click();
  await page.getByRole("region", { name: "答案與解析" }).waitFor();
  assert.equal(await page.getByRole("group", { name: "答案選項" }).locator("button:disabled").count(), 4);
  await page.getByRole("button", { name: "下一題", exact: true }).click();
  await options().first().click();
  await page.getByRole("button", { name: "完成測驗", exact: true }).click();
  await page.getByRole("heading", { name: "題目回顧" }).waitFor();
  const before = await page.evaluate(() => ({ wrong: localStorage.getItem("wrongQuestions"), favorites: localStorage.getItem("favorites"), progress: localStorage.getItem("progress") }));
  assert(JSON.parse(before.wrong).some((item) => item.id === questions[0].id));
  assert(JSON.parse(before.wrong).some((item) => item.id === -1));
  await page.getByRole("button", { name: "重新測驗" }).click();
  await options().first().waitFor();
  assert.deepEqual(await page.evaluate(() => ({ wrong: localStorage.getItem("wrongQuestions"), favorites: localStorage.getItem("favorites"), progress: localStorage.getItem("progress") })), before);
  await page.waitForTimeout(700); // Bounded retry finishes before the next scenario.
  assert(posts.length >= 2);
  console.log("PASS stats failure never blocks practice, wrong book or restart; existing storage preserved");

  offline = false; posts = [];
  await page.goto(quizUrl("exam"));
  await options().first().click();
  await page.getByRole("button", { name: "下一題", exact: true }).click();
  await options().first().click();
  await page.getByRole("heading", { name: "題目回顧" }).waitFor();
  await page.waitForTimeout(100);
  assert.equal(posts.length, 1); assert.equal(posts[0].answers.length, 2);
  console.log("PASS automatic exam submission sends one batch");

  const q = questions[0];
  await page.route("**/api/stats/most-missed?**", (route) => route.fulfill({ json: {
    min_attempts: 10, questions: [{ question_id: q.id, question_number: q.questionNumber, exam_year: q.examYear,
      exam_subject: q.subject, question: q.question, option_a: q.options[0], option_b: q.options[1], option_c: q.options[2], option_d: q.options[3],
      total_attempts: 53, wrong_attempts: 39, wrong_rate: 73.6 }],
  } }));
  await page.goto(base + "/most-missed");
  await page.getByText("本週魔王題", { exact: true }).waitFor();
  assert(!(await page.locator("article").innerText()).includes("正確答案"));
  assert((await page.locator("article").innerText()).includes("39 / 53"));
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 812 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.getByRole("button", { name: "全期間", exact: true }).click();
  await page.getByText("第 1 名", { exact: true }).waitFor();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("link", { name: "開始作答", exact: true }).click();
  await options().first().waitFor();
  assert.equal(await page.locator("h1").innerText(), q.question);
  assert.equal(await page.getByRole("region", { name: "答案與解析" }).count(), 0);
  await options().first().click();
  await page.getByRole("region", { name: "答案與解析" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS leaderboard card, time filter, mobile layout and same-question practice link");
} finally { await browser.close(); }
