import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const testDirectory = dirname(fileURLToPath(import.meta.url));

function load(relativePath, mocks = {}) {
  const code = ts.transpileModule(readFileSync(resolve(testDirectory, "..", relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error(`Unexpected import: ${name}`);
  }, exports);
  return exports;
}

const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };
const request = (query = "") => new Request(`https://example.test/api/admin/health${query}`);

test("health requires server-side admin identity and does not trust query or headers", async () => {
  let session = null;
  let connections = 0;
  const previousAdmin = process.env.ADMIN_USER_ID;
  const previousUrl = process.env.DATABASE_URL;
  process.env.ADMIN_USER_ID = "real-admin";
  process.env.DATABASE_URL = "mock";
  try {
    const guard = load("lib/admin.ts", {
      "@/lib/auth": { auth: { api: { getSession: async () => session } } },
      "@neondatabase/serverless": { neon: () => { connections++; return async () => [{ errors: [] }]; } },
    });
    const health = load("app/api/admin/health/route.ts", { "next/server": nextServer, "@/lib/admin": guard });
    for (session of [null, { user: { id: "regular" } }]) {
      const response = await health.GET(new Request("https://example.test/?userId=real-admin", { headers: { "x-user-id": "real-admin" } }));
      assert.equal(response.status, 403);
    }
    assert.equal(connections, 0);
    session = { user: { id: "real-admin" } };
    assert.equal((await health.GET(request())).status, 200);
    assert.equal(connections, 1);
  } finally {
    if (previousAdmin === undefined) delete process.env.ADMIN_USER_ID; else process.env.ADMIN_USER_ID = previousAdmin;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});

test("health preserves actual zero counts and disables caching", async () => {
  const data = { checked_at: "2026-09-05T00:00:00Z", last_24_hours: 0, last_7_days: 0, errors: [] };
  const health = load("app/api/admin/health/route.ts", {
    "next/server": nextServer,
    "@/lib/admin": { requireAdmin: async () => ({ sql: async () => [data] }) },
  });
  const response = await health.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), data);
});

test("health database failure is unknown/503, not a successful zero-count response", async () => {
  const health = load("app/api/admin/health/route.ts", {
    "next/server": nextServer,
    "@/lib/admin": { requireAdmin: async () => ({ sql: async () => { throw new Error("private database details"); } }) },
  });
  const response = await health.GET(request());
  assert.equal(response.status, 503);
  const data = await response.json();
  assert.equal(data.last_24_hours, undefined);
  assert(!JSON.stringify(data).includes("private database details"));
  // An unexpected logger import would fail in load(): health does not log itself.
});

test("logger only stores fixed events and coarse classifications, with a bounded request", async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "mock";
  try {
    const writes = [];
    let fail = false;
    const logger = load("lib/system-errors.ts", {
      "server-only": {},
      "@/lib/system-error-events": load("lib/system-error-events.ts"),
      "@neondatabase/serverless": { neon: (_url, options) => {
        assert(options.fetchOptions.signal instanceof AbortSignal);
        return async (_strings, ...values) => { if (fail) throw new Error("offline"); writes.push(values); };
      } },
    });
    const secret = "email@example.test password=secret token=private";
    for (const [name, expected] of [["NeonDbError", "database"], ["TimeoutError", "timeout"], ["AbortError", "timeout"], ["Error", "unexpected"]]) {
      const error = new Error(secret); error.name = name;
      await logger.recordSystemError("admin_users_read", error);
      assert.deepEqual(writes.at(-1), ["admin_users_read", expected]);
    }
    assert(!JSON.stringify(writes).includes(secret));
    await logger.recordSystemError("untrusted-event", new Error(secret));
    assert.equal(writes.length, 4);
    fail = true;
    await assert.doesNotReject(logger.recordSystemError("admin_users_read", new Error(secret)));
    delete process.env.DATABASE_URL;
    await assert.doesNotReject(logger.recordSystemError("admin_users_read", new Error(secret)));
  } finally {
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
  }
});

test("Admin catches record one event while expected failures do not create records", async () => {
  for (const [file, method, event] of [
    ["dashboard", "GET", "admin_dashboard_read"],
    ["users", "GET", "admin_users_read"],
    ["reports", "GET", "admin_reports_read"],
    ["reports", "PATCH", "admin_reports_update"],
  ]) {
    let authorized = false;
    let fail = false;
    const recorded = [];
    const route = load(`app/api/admin/${file}/route.ts`, {
      "next/server": nextServer,
      "@/lib/admin": { requireAdmin: async () => authorized ? { sql: async () => { if (fail) throw new Error("failure"); return []; } } : null },
      "@/lib/system-errors": { recordSystemError: async (...args) => { recorded.push(args); } },
    });
    const makeRequest = (invalid = false) => method === "PATCH"
      ? new Request("https://example.test", { method, body: invalid ? "{" : JSON.stringify({ id: "1", status: "resolved" }) })
      : request(invalid ? "?page=-1" : "");
    assert.equal((await route[method](makeRequest())).status, 403);
    authorized = true;
    if (file !== "dashboard") assert.equal((await route[method](makeRequest(true))).status, 400);
    if (method === "PATCH") assert.equal((await route[method](makeRequest())).status, 404);
    assert.equal(recorded.length, 0);
    fail = true;
    assert.equal((await route[method](makeRequest())).status, 500);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0][0], event);
  }
});
