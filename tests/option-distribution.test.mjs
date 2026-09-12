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
const { mostMistaken } = load("lib/option-distribution.ts");

test("normalize single-letter answers; reject injected, fake and malformed submissions", () => {
  assert.deepEqual(stats.parseAnswerSubmissions({ answers: [{ question_id: 1, selected_answer: "c" }] }), [{ question_id: 1, selected_answer: "C" }]);
  for (const selected_answer of ["Z", "ABC", "<script>", "1", " C", 1]) {
    assert.equal(stats.parseAnswerSubmissions({ answers: [{ question_id: 1, selected_answer }] }), null);
  }
});

test("sample threshold hides option counts; sufficient samples use valid denominator and rounding", async () => {
  assert.deepEqual(await stats.optionDistribution(async () => [], 1), null);
  const small = await stats.optionDistribution(async () => [{ letter: "B", count: 4 }], 1);
  assert.equal(small.sufficient, false); assert.deepEqual(small.options, []);
  const data = await stats.optionDistribution(async () => [
    { letter: "A", count: 1 }, { letter: "B", count: 2 }, { letter: "C", count: 3 }, { letter: "D", count: 0 },
  ], 1);
  assert.equal(data.total, 6); assert.equal(data.sufficient, true);
  assert.deepEqual(data.options.map((o) => o.percentage), [16.7, 33.3, 50, 0]);
  assert(Math.abs(data.options.reduce((sum, o) => sum + o.percentage, 0) - 100) <= 0.2);
  assert.deepEqual(mostMistaken(data.options, "c").map((o) => o.letter), ["B"]);
  assert.deepEqual(mostMistaken([{ letter: "A", count: 3 }, { letter: "B", count: 3 }, { letter: "C", count: 9 }], "C").map((o) => o.letter), ["A", "B"]);
  assert.deepEqual(mostMistaken([{ letter: "A", count: 0 }, { letter: "C", count: 5 }], "C"), []);
  assert.deepEqual(mostMistaken(data.options, ""), []);
});

test("public distribution endpoint validates IDs, returns aggregates only, handles missing/private and outages", async () => {
  let result = { total: 5, sufficient: true, min_attempts: 5, options: [{ letter: "B", count: 5, percentage: 100 }] };
  let failure = false, calls = 0;
  const route = load("app/api/stats/option-distribution/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@neondatabase/serverless": { neon: () => ({ query: async () => [] }) },
    "@/lib/question-stats": { optionDistribution: async (_query, id) => {
      assert.equal(id, 1); calls++; if (failure) throw new Error("offline"); return result;
    } },
  });
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = "fixture";
  const request = (id) => new Request(`https://vetexam.test/api/stats/option-distribution?questionId=${id}`);
  try {
    for (const id of ["", "0", "-1", "abc", "1.5", "1e2", "2147483648"]) assert.equal((await route.GET(request(id))).status, 400);
    assert.equal(calls, 0);
    const response = await route.GET(request("1"));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), result);
    result = null; assert.equal((await route.GET(request("1"))).status, 404);
    failure = true; assert.equal((await route.GET(request("1"))).status, 503);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test("PostgreSQL migration preserves legacy NULL, immutable first choices, real aggregates and Taiwan weekly ranking", { skip: process.env.STATS_DB_TEST !== "1" }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const schema = "options_test_" + randomUUID().replaceAll("-", "");
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema},public`);
    await client.query('CREATE TABLE "user" (id text PRIMARY KEY)');
    await client.query("CREATE TABLE question_sets (id integer PRIMARY KEY, visibility text, exam_year integer)");
    await client.query("CREATE TABLE questions (id integer PRIMARY KEY, question_set_id integer, question_number integer, subject text, question text, answer text, option_a text, option_b text, option_c text, option_d text, option_e text)");
    await client.query(readFileSync(new URL("../migrations/20260912_question_answer_stats.sql", import.meta.url), "utf8"));
    await client.query('INSERT INTO "user" SELECT \'u\' || i FROM generate_series(1,20) i');
    await client.query("INSERT INTO question_sets VALUES (1,'public',2026),(2,'private',2026)");
    await client.query("INSERT INTO questions SELECT i, CASE WHEN i=3 THEN 2 ELSE 1 END, i, 'subject', 'question', 'C', 'a','b','c','d',NULL FROM generate_series(1,5) i");
    await client.query("INSERT INTO question_answer_stats (user_id,question_id,is_correct) VALUES ('u20',1,true)");
    const migration = readFileSync(new URL("../migrations/20260912_option_distribution.sql", import.meta.url), "utf8");
    await client.query(migration); await client.query(migration);
    const query = async (text, values) => (await client.query(text, values)).rows;
    const submit = (user, id, answer) => stats.recordFirstAnswers(query, user, [{ question_id: id, selected_answer: answer }]);
    await submit("u20", 1, "C");
    assert.equal((await query("SELECT selected_answer FROM question_answer_stats WHERE user_id='u20'", []))[0].selected_answer, null);
    await submit("u1", 1, "B");
    const first = (await query("SELECT * FROM question_answer_stats WHERE user_id='u1'", []))[0];
    assert.equal(first.selected_answer, "B"); assert.equal(first.is_correct, false);
    await submit("u1", 1, "C");
    assert.deepEqual((await query("SELECT * FROM question_answer_stats WHERE user_id='u1'", []))[0], first);
    await submit("u2", 1, "C");
    assert.equal((await stats.optionDistribution(query, 1)).total, 2);
    for (let i = 3; i <= 5; i++) await submit(`u${i}`, 1, "B");
    const data = await stats.optionDistribution(query, 1);
    assert.equal(data.total, 5); assert.equal(data.sufficient, true);
    assert.deepEqual(data.options.map((o) => [o.letter, o.count, o.percentage]), [["A",0,0],["B",4,80],["C",1,20],["D",0,0]]);
    assert.deepEqual(mostMistaken(data.options, "C").map((o) => o.letter), ["B"]);
    await submit("u1", 2, "E"); await submit("u1", 3, "B"); await submit("u1", 999, "B");
    assert.equal((await query("SELECT COUNT(*)::int AS n FROM question_answer_stats WHERE question_id<>1", []))[0].n, 0);
    assert.equal(await stats.optionDistribution(query, 3), null);
    assert.equal(await stats.optionDistribution(query, 999), null);
    assert.deepEqual((await stats.optionDistribution(query, 2)).options, []);
    for (let i = 6; i <= 10; i++) await submit(`u${i}`, 1, "B");
    for (let i = 1; i <= 20; i++) await submit(`u${i}`, 2, i <= 12 ? "B" : "C");
    assert.equal((await stats.weeklyMostMissed(query))[0].question_id, 2, "rank by wrong people, not wrong rate");
    await client.query("UPDATE question_answer_stats SET created_at=(DATE_TRUNC('week',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei')-INTERVAL '1 microsecond' WHERE question_id=2");
    assert.equal((await stats.weeklyMostMissed(query))[0].question_id, 1);
    await client.query("UPDATE question_answer_stats SET created_at=DATE_TRUNC('week',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei' WHERE question_id=2");
    assert.equal((await stats.weeklyMostMissed(query))[0].question_id, 2, "Monday 00:00 included");
    await client.query("UPDATE question_answer_stats SET created_at=CURRENT_TIMESTAMP+INTERVAL '1 day' WHERE question_id=2");
    assert.equal((await stats.weeklyMostMissed(query))[0].question_id, 1, "future rows excluded");
    const plan = await query("EXPLAIN " + stats.OPTION_DISTRIBUTION_SQL, [1]);
    assert(plan.length > 0);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
