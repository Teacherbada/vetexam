import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";
import pg from "pg";
import nextEnv from "@next/env";

function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function("require", "exports", code)((name) => {
    if (name === "server-only") return {};
    if (name in mocks) return mocks[name];
    throw Error(`Unexpected import ${name}`);
  }, exports);
  return exports;
}
const shared = load("lib/import-batches.ts");
const service = load("lib/pdf-batch-import.ts", { "node:crypto": { createHash }, "./import-batches": shared });
const metadata = { filename: "exam.pdf", fileHash: "a".repeat(64), visibility: "public", examYear: 2026, examSubject: "subject" };
const questions = Array.from({ length: 4 }, (_, i) => ({ id: 100 + i, subject: "unused", pageNumber: i + 1, imageSource: "manual", question: "題目" + (i + 1), options: ["a", "b", "c", "d", "e"], answer: "C", explanation: "解析", imageDataUrl: "data:image/png;base64,YQ==" }));
const ranges = [{ from: 1, to: 2 }, { from: 3, to: 4 }];
const inputs = (id = randomUUID(), meta = metadata) => shared.buildImportBatches(meta, questions, ranges, id).map((batch) => service.parseImportBatch(JSON.parse(batch.body)));

test("ranges cover every displayed question once and retain only required fields", () => {
  for (const bad of [[], [{ from: 1, to: 2 }], [{ from: 1, to: 2 }, { from: 2, to: 4 }], [{ from: 1, to: 2 }, { from: 4, to: 4 }], [{ from: 0, to: 4 }], [{ from: 1, to: 4.5 }]]) assert.throws(() => shared.validateImportRanges(bad, 4));
  const batches = inputs();
  assert.deepEqual(batches.flatMap((batch) => batch.questions.map((q) => q.question)), questions.map((q) => q.question));
  assert.equal(batches[1].ranges[1].from, 3);
  assert.equal(batches[0].questions[0].options.length, 5);
  assert.equal(batches[0].questions[0].imageDataUrl, questions[0].imageDataUrl);
  for (const key of ["id", "pageNumber", "subject", "imageSource"]) assert(!(key in batches[0].questions[0]));
});

test("preflight counts UTF-8/base64 bytes and rejects oversized batches before requests", () => {
  const large = { ...questions[0], imageDataUrl: "data:image/png;base64," + "A".repeat(2_100_000) };
  assert.throws(() => shared.buildImportBatches(metadata, [large, large], [{ from: 1, to: 2 }], randomUUID()), /超過 4 MB/);
  assert.equal(shared.buildImportBatches(metadata, [large, large], [{ from: 1, to: 1 }, { from: 2, to: 2 }], randomUUID()).length, 2);
  assert.throws(() => shared.buildImportBatches(metadata, [{ ...large, imageDataUrl: "data:image/png;base64," + "A".repeat(4_000_000) }], [{ from: 1, to: 1 }], randomUUID()), /只有一題/);
});

test("plain-text 413 and non-JSON errors give useful messages, not JSON syntax errors", async () => {
  await assert.rejects(shared.readImportResponse(new Response("Request Entity Too Large", { status: 413 })), /HTTP 413/);
  await assert.rejects(shared.readImportResponse(new Response("<html>error</html>", { status: 502 })), /HTTP 502/);
  await assert.rejects(shared.readImportResponse(Response.json({ error: "duplicate" }, { status: 409 })), /duplicate/);
  assert.deepEqual(await shared.readImportResponse(Response.json({ questionSetId: 1, complete: true })), { questionSetId: 1, complete: true });
});

test("server validates plan and counts independently of frontend", () => {
  const [batch] = inputs();
  for (const value of [{ ...batch, questions: [] }, { ...batch, importId: "bad" }, { ...batch, fileHash: "bad" }, { ...batch, batchIndex: 5 }, { ...batch, totalQuestions: 5 }, { ...batch, questions: [{ ...batch.questions[0], imageDataUrl: "https://example.test/private" }, batch.questions[1]] }]) assert.throws(() => service.parseImportBatch(value));
});

test("PostgreSQL stages, resumes, finalizes atomically and rejects foreign/changed/duplicate imports", { skip: process.env.PDF_BATCH_DB_TEST !== "1" }, async () => {
  nextEnv.loadEnvConfig(process.cwd());
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const schema = "pdf_batch_test_" + randomUUID().replaceAll("-", "");
  try {
    await client.query("BEGIN"); await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET LOCAL search_path TO ${schema},public`);
    await client.query('CREATE TABLE "user"(id text PRIMARY KEY)');
    await client.query("CREATE TABLE question_sets(id serial PRIMARY KEY,name text,filename text,total_questions integer,file_hash text,visibility text,owner_id text,exam_subject text,exam_year integer,UNIQUE(file_hash,visibility))");
    await client.query("CREATE TABLE questions(id serial PRIMARY KEY,question_set_id integer,question_number integer,subject text,question text,option_a text,option_b text,option_c text,option_d text,option_e text,answer text,explanation text,image_data_url text)");
    const migration = readFileSync(new URL("../migrations/20260912_pdf_batch_imports.sql", import.meta.url), "utf8");
    await client.query(migration); await client.query(migration);
    await client.query('INSERT INTO "user" VALUES (\'owner\'),(\'other\')');
    let sequence = 0;
    async function save(batch, user = "owner", admin = true) {
      const name = `call_${sequence++}`; await client.query(`SAVEPOINT ${name}`);
      try { const result = await service.saveImportBatch(client, user, admin, batch); await client.query(`RELEASE SAVEPOINT ${name}`); return result; }
      catch (error) { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); throw error; }
    }
    const [first, second] = inputs();
    await assert.rejects(save(first, "owner", false), /管理員/);
    assert.equal((await save(first)).complete, false);
    assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM question_sets")).rows[0].n, 0);
    assert.equal((await save(first)).receivedBatches, 1, "retry is idempotent");
    await assert.rejects(save(first, "other"), /無法存取/);
    await assert.rejects(save({ ...first, examYear: 2025 }), /設定已改變/);
    await assert.rejects(save({ ...first, questions: [{ ...first.questions[0], question: "changed" }, first.questions[1]] }), /內容/);
    // Simulate an insertion failure; no half-created final set may survive.
    await client.query("ALTER TABLE questions ADD CONSTRAINT fixture_failure CHECK(question_number<4)");
    await assert.rejects(save(second));
    assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM question_sets")).rows[0].n, 0);
    assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM pdf_import_chunks")).rows[0].n, 1);
    await client.query("ALTER TABLE questions DROP CONSTRAINT fixture_failure");
    const result = await save(second);
    assert.equal(result.complete, true);
    const rows = (await client.query("SELECT id,question_number,question,option_e,image_data_url FROM questions ORDER BY question_number")).rows;
    assert.deepEqual(rows.map((row) => row.question_number), [1, 2, 3, 4]);
    assert.deepEqual(rows.map((row) => row.question), questions.map((q) => q.question));
    assert(rows.every((row) => row.option_e === "e" && row.image_data_url === questions[0].imageDataUrl));
    assert.equal((await save(second)).questionSetId, result.questionSetId);
    assert.equal((await save(first)).questionSetId, result.questionSetId, "lost final response retry returns same set");
    assert.deepEqual((await client.query("SELECT id FROM questions ORDER BY question_number")).rows.map((row) => row.id), rows.map((row) => row.id));
    assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM pdf_import_chunks WHERE questions IS NOT NULL")).rows[0].n, 0);
    const duplicate = inputs(); await save(duplicate[0]); await assert.rejects(save(duplicate[1]), /已經存在/);
    assert.equal((await client.query("SELECT COUNT(*)::int AS n FROM question_sets")).rows[0].n, 1);
    const privateInputs = inputs(randomUUID(), { ...metadata, visibility: "private", fileHash: "b".repeat(64) });
    // Even out-of-order arrival cannot reorder the final question numbers.
    await save(privateInputs[1], "owner", false); await save(privateInputs[0], "owner", false);
    assert.equal((await client.query("SELECT total_questions FROM question_sets WHERE visibility='private'")).rows[0].total_questions, 4);
  } finally { await client.query("ROLLBACK"); await client.end(); }
});
