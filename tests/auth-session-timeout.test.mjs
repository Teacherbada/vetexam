import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { createAuthClient } from 'better-auth/client';

const exports = {};
new Function('exports', ts.transpileModule(readFileSync('lib/auth-session-fetch.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(exports);
const { fetchAuthSession, AUTH_SESSION_TIMEOUT_MS } = exports;
const url = 'https://vetexam-tw.vercel.app/api/auth/get-session';
const fixture = { user: { id: 'fixture', name: 'Fixture', email: 'fixture@example.test' }, session: { id: 'fixture', userId: 'fixture', expiresAt: '2099-01-01T00:00:00Z' } };

test('real Better Auth hook exits loading on stalled headers/body and can retry without logout', async () => {
  const original = { fetch: globalThis.fetch, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, error: console.error };
  let expire, signal, clears = 0;
  const events = [];
  try {
    console.error = (...args) => events.push(args);
    globalThis.setTimeout = (fn, ms, ...args) => ms === AUTH_SESSION_TIMEOUT_MS ? (expire = fn, 456) : original.setTimeout(fn, ms, ...args);
    globalThis.clearTimeout = id => { if (id === 456) clears++; else original.clearTimeout(id); };
    for (const stage of ['headers', 'body']) {
      globalThis.fetch = async (_, options) => {
        signal = options.signal;
        assert.equal(options.credentials, 'include');
        assert.equal(options.cache, 'no-store');
        if (stage === 'headers') return new Promise(() => {});
        return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } });
      };
      const client = createAuthClient({ baseURL: 'https://vetexam-tw.vercel.app', fetchOptions: { customFetchImpl: fetchAuthSession, credentials: 'include', cache: 'no-store' } });
      const atom = client.$store.atoms.session;
      const pending = atom.get().refetch();
      assert.equal(atom.get().isPending, true);
      await new Promise(resolve => setImmediate(resolve));
      expire(); await pending;
      assert.equal(signal.aborted, true);
      assert.equal(atom.get().isPending, false);
      assert.equal(atom.get().error.message, 'AUTH_SESSION_TIMEOUT');
      assert.equal(atom.get().data, null);
      globalThis.fetch = async () => Response.json(fixture);
      await atom.get().refetch();
      assert.equal(atom.get().error, null);
      assert.equal(atom.get().data.user.id, 'fixture');
      // A later failure retains the last verified user while exposing the error.
      globalThis.fetch = async () => new Promise(() => {});
      const refresh = atom.get().refetch();
      await new Promise(resolve => setImmediate(resolve));
      expire(); await refresh;
      assert.equal(atom.get().data.user.id, 'fixture');
      assert.equal(atom.get().error.message, 'AUTH_SESSION_TIMEOUT');
    }
    assert.equal(clears, 6);
    assert.equal(events.length, 4);
    assert.doesNotMatch(JSON.stringify(events), /fixture@example|session_token|password/);
  } finally { globalThis.fetch = original.fetch; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; console.error = original.error; }
});

test('parent cancellation is preserved and unrelated auth requests pass through unchanged', async () => {
  const original = globalThis.fetch;
  try {
    let seen;
    globalThis.fetch = async (input, init) => { seen = { input, init }; return Response.json({ ok: true }); };
    const init = { method: 'POST', body: 'unchanged', credentials: 'include' };
    await fetchAuthSession('https://vetexam-tw.vercel.app/api/auth/sign-in/email', init);
    assert.equal(seen.init, init);
    const parent = new AbortController();
    globalThis.fetch = async (_, { signal }) => { seen = signal; return new Promise(() => {}); };
    const pending = fetchAuthSession(url, { signal: parent.signal });
    parent.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(seen.aborted, true);
  } finally { globalThis.fetch = original; }
});

test('successful and failed HTTP responses retain body, status and headers', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [200, 401, 503]) {
      const response = Response.json(status === 200 ? fixture : { error: 'unavailable' }, { status, headers: { 'Cache-Control': 'private, no-store' } });
      globalThis.fetch = async () => response;
      const result = await fetchAuthSession(url);
      assert.equal(result, response);
      assert.equal(result.status, status);
      assert.equal(result.headers.get('cache-control'), 'private, no-store');
      assert.deepEqual(await result.json(), status === 200 ? fixture : { error: 'unavailable' });
    }
  } finally { globalThis.fetch = original; }
});
