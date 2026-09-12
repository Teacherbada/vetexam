import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";
import nextEnv from "@next/env";
import pg from "pg";

function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("require", "exports", code)((name) => {
    if (name === "server-only") return {};
    if (name in mocks) return mocks[name];
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  return exports;
}
const stats = load("lib/question-stats.ts");

test("strict submissions reject client correctness, invalid IDs/options and excessive batches", () => {
  const answer = { question_id: 1, selected_answer: "B" };
  assert.deepEqual(stats.parseAnswerSubmissions({ answers: [answer, { ...answer, selected_answer: "C" }] }), [answer]);
  for (const body of [null, {}, { answers: [] }, { answers: [answer], is_correct: true },
    { answers: [{ ...answer, is_correct: true }] }, { answers: [{ ...answer, question_id: -1 }] },
    { answers: [{ ...answer, question_id: 1.1 }] }, { answers: [{ ...answer, selected_answer: "" }] },
    { answers: Array(101).fill(answer) }]) assert.equal(stats.parseAnswerSubmissions(body), null);
});

test("ROC display handles ROC and western input without modifying filter values", () => {
  const { formatExamYear } = load("lib/exam-year.ts");
  assert.equal(formatExamYear(115), "民國 115 年（西元 2026）");
  assert.equal(formatExamYear(2026), "民國 115 年（西元 2026）");
  assert.equal(formatExamYear(null), "年份未提供");
});

test("stats POST uses session identity, skips guests, validates origin/payload, and returns no answer", async () => {
  let user = null, writes = 0, failure = false;
  const route = load("app/api/stats/answers/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/auth": { auth: { api: { getSession: async () => user ? { user: { id: user } } : null } } },
    "@neondatabase/serverless": { neon: () => ({ query: async () => [] }) },
    "@/lib/question-stats": { ...stats, recordFirstAnswers: async (_query, userId, answers) => {
      assert.equal(userId, "session-user"); assert.equal(answers[0].selected_answer, "B");
      writes++; if (failure) throw new Error("offline");
    } },
  });
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "fixture";
  const request = (body, origin = "https://vetexam.test") => new Request("https://vetexam.test/api/stats/answers", {
    method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
  });
  const valid = { answers: [{ question_id: 1, selected_answer: "B" }] };
  try {
    assert.deepEqual(await (await route.POST(request(valid))).json(), { success: true, recorded: false });
    assert.equal(writes, 0);
    user = "session-user";
    assert.equal((await route.POST(request(valid, "https://evil.test"))).status, 403);
    assert.equal((await route.POST(request({ answers: [{ ...valid.answers[0], is_correct: true }] }))).status, 400);
    assert.equal((await route.POST(request({ answers: [], padding: "x".repeat(17000) }))).status, 413);
    assert.deepEqual(await (await route.POST(request(valid))).json(), { success: true });
    assert.equal(writes, 1);
    failure = true;
    assert.equal((await route.POST(request(valid))).status, 503);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test("PostgreSQL first-answer stats, immutable retries, threshold, ranking, privacy and 7-day window", { skip: process.env.STATS_DB_TEST !== "1" }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const schema = "stats_test_" + randomUUID().replaceAll("-", "");
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema},public`);
    // Only fixture tables receive test rows. The whole schema rolls back.
    await client.query('CREATE TABLE "user" (id text PRIMARY KEY)');
    await client.query("CREATE TABLE question_sets (id integer PRIMARY KEY, visibility text, exam_year integer)");
    await client.query("CREATE TABLE questions (id integer PRIMARY KEY, question_set_id integer, question_number integer, subject text, question text, answer text, option_a text, option_b text, option_c text, option_d text, option_e text)");
    const migration = readFileSync(new URL("../migrations/20260912_question_answer_stats.sql", import.meta.url), "utf8");
    await client.query(migration); await client.query(migration);
    await client.query(readFileSync(new URL("../migrations/20260912_option_distribution.sql", import.meta.url), "utf8"));
    await client.query('INSERT INTO "user" SELECT \'u\' || i FROM generate_series(1,12) i');
    await client.query("INSERT INTO question_sets VALUES (1,'public',2026),(2,'private',2026)");
    await client.query("INSERT INTO questions SELECT i, CASE WHEN i=6 THEN 2 ELSE 1 END, i, 'subject', 'question', 'C', 'a','b','c','d',NULL FROM generate_series(1,6) i");
    const query = async (text, values) => (await client.query(text, values)).rows;
    const submit = (user, id, answer) => stats.recordFirstAnswers(query, user, [{ question_id: id, selected_answer: answer }]);
    await submit("u1", 1, "B");
    const first = (await query("SELECT * FROM question_answer_stats", []))[0];
    assert.equal(first.is_correct, false);
    assert.equal(first.selected_answer, "B");
    await submit("u1", 1, "C");
    const retried = await query("SELECT * FROM question_answer_stats", []);
    assert.equal(retried.length, 1); assert.deepEqual(retried[0], first);
    await submit("u2", 1, "C");
    assert.deepEqual((await query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE NOT is_correct)::int AS wrong FROM question_answer_stats", []))[0], { total: 2, wrong: 1 });
    assert.deepEqual(await stats.mostMissed(query, "all", null, null), []);
    for (let i = 3; i <= 10; i++) await submit(`u${i}`, 1, "B");
    for (let i = 1; i <= 12; i++) await submit(`u${i}`, 2, i === 12 ? "C" : "B");
    for (let i = 1; i <= 10; i++) await submit(`u${i}`, 3, i === 10 ? "C" : "B");
    for (let i = 1; i <= 9; i++) await submit(`u${i}`, 4, "B");
    for (let i = 1; i <= 10; i++) await submit(`u${i}`, 5, "B");
    await submit("u1", 6, "B"); await submit("u1", 999999, "B"); await submit("u1", 4, "E");
    assert.equal((await query("SELECT COUNT(*)::int AS n FROM question_answer_stats WHERE question_id IN (6,999999)", []))[0].n, 0);
    const all = await stats.mostMissed(query, "all", null, null);
    assert.deepEqual(all.map((q) => q.question_id), [5, 2, 1, 3]);
    assert.equal(all.find((q) => q.question_id === 1).wrong_attempts, 9);
    for (const row of all) for (const key of ["user_id", "email", "name", "answer", "explanation", "selected_answer"]) assert(!(key in row));
    await client.query("UPDATE question_answer_stats SET created_at=CURRENT_TIMESTAMP-INTERVAL '8 days' WHERE question_id=5 OR (question_id=1 AND user_id='u1')");
    await submit("u1", 1, "C"); // Retry cannot turn an old answer into a weekly one.
    assert.deepEqual((await stats.mostMissed(query, "7d", "subject", 2026)).map((q) => q.question_id), [2, 3]);
    assert.deepEqual(await stats.mostMissed(query, "all", "other", null), []);
    assert.deepEqual(await stats.mostMissed(query, "all", null, 2025), []);
    // Equal rates rank by larger sample, then stable question ID.
    await client.query("UPDATE question_answer_stats SET is_correct=false WHERE question_id IN (2,3)");
    assert.deepEqual((await stats.mostMissed(query, "all", null, null)).map((q) => q.question_id), [2, 3, 5, 1]);
    assert.equal((await query("SELECT COUNT(*)::int AS n FROM pg_indexes WHERE schemaname=$1 AND tablename='question_answer_stats'", [schema]))[0].n, 4);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
