import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import ts from 'typescript';

test('configured Better Auth uses persistent host-only HTTPS cookies and validates production origins', async () => {
  const origin = 'https://vetexam-tw.vercel.app';
  const previous = { DATABASE_URL: process.env.DATABASE_URL, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET };
  process.env.DATABASE_URL = 'fixture';
  process.env.BETTER_AUTH_URL = origin;
  process.env.BETTER_AUTH_SECRET = 'isolated-cookie-test-secret-not-production-2026';
  try {
    const exports = {};
    const mocks = {
      'better-auth': { betterAuth: options => options },
      pg: { Pool: class {} },
      '@neondatabase/serverless': { neon: () => {} },
      '@/lib/subscription/service': { startTrialForNewUser: () => {} },
    };
    new Function('require', 'exports', ts.transpileModule(readFileSync('lib/auth.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(name => mocks[name], exports);
    const database = { user: [], session: [], account: [], verification: [] };
    const auth = betterAuth({ ...exports.auth, database: memoryAdapter(database), databaseHooks: undefined, logger: { disabled: true } });
    const post = (path, body, requestOrigin = origin) => auth.handler(new Request(origin + '/api/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: requestOrigin }, body: JSON.stringify(body) }));
    const credentials = { email: 'fixture@example.test', password: 'fixture-password-only-123' };
    const signedUp = await post('sign-up/email', { ...credentials, name: 'Fixture' });
    assert.equal(signedUp.status, 200);
    const signedIn = await post('sign-in/email', { ...credentials, rememberMe: true, callbackURL: origin + '/' });
    assert.equal(signedIn.status, 200);
    const cookie = signedIn.headers.getSetCookie().find(value => value.startsWith('__Secure-better-auth.session_token='));
    assert.ok(cookie);
    assert.match(cookie, /; Secure/i); assert.match(cookie, /; HttpOnly/i);
    assert.match(cookie, /; SameSite=Lax/i); assert.match(cookie, /; Path=\//i);
    assert.match(cookie, /; Max-Age=2592000/i); assert.doesNotMatch(cookie, /; Domain=/i);
    for (let i = 0; i < 2; i++) {
      const result = await auth.handler(new Request(origin + '/api/auth/get-session', { headers: { Cookie: cookie.split(';')[0] } }));
      assert.equal(result.status, 200);
      assert.equal((await result.json()).user.email, credentials.email);
    }
    const anonymous = await auth.handler(new Request(origin + '/api/auth/get-session'));
    assert.equal(await anonymous.json(), null);
    assert.equal((await post('sign-in/email', credentials, 'https://other.example')).status, 403);
    assert.equal((await post('sign-in/email', { ...credentials, callbackURL: 'https://other.example' })).status, 403);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
