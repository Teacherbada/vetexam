import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === 'server-only') return {};
    if (name in mocks) return mocks[name];
    throw Error(name);
  }, exports);
  return exports;
}
const request = (path = '/api/auth/get-session') => new Request('https://vetexam-tw.vercel.app' + path, { headers: { cookie: '__Secure-better-auth.session_token=DO_NOT_LOG_TOKEN', authorization: 'DO_NOT_LOG_SECRET' } });

test('homepage effects work without AbortSignal.any/timeout and distinguish timeout from unmount', async () => {
  const original = { fetch: globalThis.fetch, any: AbortSignal.any, timeout: AbortSignal.timeout, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  try {
    AbortSignal.any = AbortSignal.timeout = undefined;
    for (const path of ['components/dashboard/useHomeAvailability.ts', 'components/dashboard/WeeklyMostMissed.tsx']) {
      for (const action of ['success', 'timeout', 'unmount']) {
        let effect, expire, cleared = 0, index = 0;
        const writes = [];
        globalThis.setTimeout = fn => { expire = fn; return 321; };
        globalThis.clearTimeout = () => cleared++;
        globalThis.fetch = async (_, { signal }) => action === 'success' ? Response.json({ availability: [], chapterAvailability: [], question: null }) : new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('abort'))));
        const component = load(path, {
          react: { useEffect: fn => { effect = fn; }, useState: initial => { const key = index++; return [initial, value => writes.push({ key, value })]; } },
          'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
          'next/link': {}, './StudyUI': {}, './WeeklyQuestionDialog': {},
        });
        (component.default ?? component.useHomeAvailability)();
        const cleanup = effect();
        if (action === 'timeout') expire();
        if (action === 'unmount') cleanup();
        await new Promise(resolve => setImmediate(resolve));
        if (action === 'success') assert.ok(writes.some(write => write.key === 0));
        if (action === 'timeout') assert.deepEqual(writes, [{ key: 1, value: true }]);
        if (action === 'unmount') assert.deepEqual(writes, []);
        assert.ok(cleared > 0); cleanup();
      }
    }
  } finally { globalThis.fetch = original.fetch; AbortSignal.any = original.any; AbortSignal.timeout = original.timeout; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; }
});

test('admin lookup works without AbortSignal.timeout and always clears its timer', async () => {
  const original = { fetch: globalThis.fetch, timeout: AbortSignal.timeout, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let calls = 0, cleared = 0, expire;
  try {
    AbortSignal.timeout = undefined;
    globalThis.setTimeout = fn => { expire = fn; return 123; };
    globalThis.clearTimeout = id => { assert.equal(id, 123); cleared++; };
    globalThis.fetch = async (_, options) => { calls++; assert.equal(options.credentials, 'same-origin'); return Response.json({ isAdmin: true }); };
    const { readAdminStatus } = load('lib/admin-status-client.ts');
    const a = readAdminStatus('member');
    assert.equal(a, readAdminStatus('member'));
    assert.equal(await a, true);
    assert.equal(calls, 1);
    assert.equal(cleared, 1);
    globalThis.fetch = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('timeout'))));
    const pending = readAdminStatus('member'); expire();
    assert.equal(await pending, false);
    assert.equal(cleared, 2);
  } finally { globalThis.fetch = original.fetch; AbortSignal.timeout = original.timeout; globalThis.setTimeout = original.setTimeout; globalThis.clearTimeout = original.clearTimeout; }
});

test('auth handler preserves cookies and distinguishes missing session, user and upstream failures', async () => {
  let response, failure = false;
  const events = [];
  const api = load('app/api/auth/[...all]/route.ts', {
    '@/lib/auth': { auth: {} },
    'better-auth/next-js': { toNextJsHandler: () => ({ GET: async () => { if (failure) throw Error('DO_NOT_LOG_SECRET'); return response; }, POST: async () => response }) },
    '@/lib/auth-diagnostics': { logAuthEvent: (event, _, stage, status) => events.push({ event, stage, status }) },
  });
  response = Response.json({ user: { id: 'member' } }, { headers: { 'Set-Cookie': 'fixture=value; Secure; HttpOnly; SameSite=Lax; Path=/', Vary: 'Origin' } });
  const success = await api.GET(request());
  assert.equal(success.headers.get('set-cookie'), 'fixture=value; Secure; HttpOnly; SameSite=Lax; Path=/');
  assert.equal(success.headers.get('cache-control'), 'private, no-store');
  assert.match(success.headers.get('vary'), /Origin, Cookie/);
  assert.deepEqual(await success.json(), { user: { id: 'member' } });
  for (const [body, event] of [[null, 'AUTH_SESSION_MISSING'], [{ session: {} }, 'USER_FETCH_FAILED']]) {
    response = Response.json(body); await api.GET(request()); assert.equal(events.at(-1).event, event);
  }
  response = Response.json({ error: 'unavailable' }, { status: 500 });
  assert.equal((await api.GET(request())).status, 500);
  assert.equal(events.at(-1).event, 'AUTH_SESSION_FETCH_FAILED');
  response = Response.json({}, { status: 403 }); await api.POST(request('/api/auth/sign-in/email'));
  assert.equal(events.at(-1).event, 'AUTH_REQUEST_FAILED');
  failure = true;
  const failed = await api.GET(request());
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /DO_NOT_LOG/);
});

test('diagnostic logging never emits cookies, auth headers or user data', () => {
  const original = { info: console.info, error: console.error };
  const logs = [];
  console.info = console.error = (...args) => logs.push(args);
  try {
    const { logAuthEvent } = load('lib/auth-diagnostics.ts');
    logAuthEvent('AUTH_SESSION_MISSING', request().headers, 'test', 200);
    logAuthEvent('AUTH_SESSION_FETCH_FAILED', new Headers(), 'test', 503);
    assert.equal(logs[0][1].hasSessionCookie, true);
    assert.equal(logs[1][1].hasSessionCookie, false);
    assert.doesNotMatch(JSON.stringify(logs), /DO_NOT_LOG|session_token|authorization/);
  } finally { Object.assign(console, original); }
});

test('debug subscription failure retains known authenticated state without exposing database errors', async () => {
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'fixture';
  let session = { user: { id: 'member' } }, sessionFailure = false;
  const events = [];
  const api = load('app/api/debug/session/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/auth': { auth: { api: { getSession: async () => { if (sessionFailure) throw Error('DO_NOT_LOG_SECRET'); return session; } } } },
    '@neondatabase/serverless': { neon: () => async () => { throw Error('DO_NOT_LOG_DATABASE'); } },
    '@/lib/auth-diagnostics': { logAuthEvent: event => events.push(event) },
  });
  try {
    let response = await api.GET(request('/api/debug/session'));
    assert.equal(response.status, 500); assert.equal((await response.json()).loggedIn, true);
    assert.equal(events.at(-1), 'SUBSCRIPTION_FETCH_FAILED');
    sessionFailure = true; response = await api.GET(request('/api/debug/session'));
    assert.doesNotMatch(await response.text(), /DO_NOT_LOG|loggedIn/);
    assert.equal(events.at(-1), 'AUTH_SESSION_FETCH_FAILED');
    sessionFailure = false; session = null; response = await api.GET(request('/api/debug/session'));
    assert.equal((await response.json()).loggedIn, false);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('learning identity does not switch to guest on pending or failed session reads', () => {
  let session, effects = [], owners = [];
  const Component = load('components/LearningSync.tsx', {
    react: { useEffect: fn => effects.push(fn) },
    '@/lib/auth-client': { authClient: { useSession: () => session } },
    '@/lib/learning-client': { setLearningOwner: id => owners.push(id), retryLearning: () => {} },
  }).default;
  for (const state of [{ data: null, isPending: true }, { data: null, isPending: false, error: Error('offline') }, { data: { user: { id: 'member' } }, isPending: false }, { data: null, isPending: false }]) {
    session = state; effects = []; Component(); effects[0]();
  }
  assert.deepEqual(owners, ['member', null]);
});
