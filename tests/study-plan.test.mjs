import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
const modes = load('lib/study-plan.ts');
function setup(userId = 'alice', execute = async () => []) {
  return load('app/api/study-plan/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@neondatabase/serverless': { neon: () => execute },
    '@/lib/auth': { auth: { api: { getSession: async () => userId ? { user: { id: userId } } : null } } },
    '@/lib/study-plan': modes,
  });
}
function request(body, headers = {}) {
  return new Request('https://test.local/api/study-plan', { method: 'PUT',
    headers: { 'Content-Type': 'application/json', origin: 'https://test.local', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
test('accepts only explicit supported modes and rejects client user IDs', () => {
  for (const mode of modes.STUDY_MODES) assert.equal(modes.parseStudyMode({ mode }), mode);
  for (const body of [null, [], {}, { mode: 'ai' }, { mode: 'coach', user_id: 'bob' }]) assert.equal(modes.parseStudyMode(body), null);
});
test('unauthenticated reads and writes cannot access storage', async () => {
  const route = setup(null, () => assert.fail('database accessed'));
  assert.equal((await route.GET(new Request('https://test.local/api/study-plan'))).status, 401);
  assert.equal((await route.PUT(request({ mode: 'coach' }))).status, 401);
});
test('new account has no automatically selected mode and response is private', async () => {
  const response = await setup().GET(new Request('https://test.local/api/study-plan'));
  assert.deepEqual(await response.json(), { mode: null });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('storage receives session identity, and switching/reloading remains account isolated', async () => {
  const records = new Map();
  const sql = async (strings, ...values) => {
    if (strings.join('').includes('INSERT INTO')) {
      assert.match(strings.join(''), /ON CONFLICT \(user_id\) DO UPDATE SET mode/);
      records.set(values[0], values[1]);
    }
    return records.has(values[0]) ? [{ mode: records.get(values[0]) }] : [];
  };
  const alice = setup('alice', sql), bob = setup('bob', sql);
  for (const mode of ['coach', 'custom', 'custom']) {
    assert.deepEqual(await (await alice.PUT(request({ mode }))).json(), { mode });
    assert.deepEqual(await (await alice.GET(new Request('https://test.local/api/study-plan'))).json(), { mode });
  }
  assert.deepEqual(await (await bob.GET(new Request('https://test.local/api/study-plan'))).json(), { mode: null });
});
test('rejects cross-origin, unsupported, malformed and oversized writes before storage', async () => {
  const route = setup('alice', () => assert.fail('database accessed'));
  for (const [req, status] of [
    [request({ mode: 'coach' }, { origin: 'https://evil.local' }), 403],
    [request({ mode: 'coach' }, { 'sec-fetch-site': 'cross-site' }), 403],
    [request({ mode: 'coach' }, { 'Content-Type': 'text/plain' }), 415],
    [request('{'), 400], [request({ mode: 'invalid' }), 400],
    [request({ mode: 'coach', user_id: 'bob' }), 400], [request('x'.repeat(1025)), 413],
  ]) assert.equal((await route.PUT(req)).status, status);
});
test('database outages return retryable errors without exposing internals', async () => {
  const route = setup('alice', () => { throw new Error('secret database information'); });
  for (const response of [await route.GET(new Request('https://test.local/api/study-plan')), await route.PUT(request({ mode: 'coach' }))]) {
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret/);
  }
});
