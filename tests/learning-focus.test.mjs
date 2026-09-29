import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function fixture() {
  let now = Date.parse('2026-09-29T12:00:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const values = new Map([['learningLegacyOwner', 'alice'], ['learningMigrated:alice', '1'], ['learningMigrated:bob', '1']]);
  const calls = [];
  const state = { owner: 'alice', failGet: false, failPost: false, hold: null };
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'POST') {
      if (state.failPost) throw Error('offline');
      return Response.json({ success: true });
    }
    if (state.failGet) throw Error('offline');
    const owner = state.owner;
    const value = url.endsWith('/summary') ? { owner, progress: {}, todayCompleted: 0, todayDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Clock()) } : { owner, progress: {}, history: [], favorites: [], wrongQuestions: [], legacy: [] };
    if (state.hold && url === '/api/learning') await state.hold;
    return Response.json(value);
  };
  const exports = {};
  const source = readFileSync(new URL('../lib/learning-client.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'fetch', 'localStorage', 'Date', js)(exports, fetch, { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }, Clock);
  return { client: exports, values, calls, state, advance: ms => { now += ms; }, fullReads: () => calls.filter(c => c.url === '/api/learning' && c.method === 'GET').length };
}

test('five fresh focus events avoid full reads; exact five-minute boundary refreshes', async () => {
  const f = fixture();
  await f.client.setLearningOwner('alice');
  assert.equal(f.fullReads(), 1);
  for (let i = 0; i < 5; i++) await f.client.refreshLearningOnFocus();
  assert.equal(f.fullReads(), 1);
  f.advance(299999); await f.client.refreshLearningOnFocus();
  assert.equal(f.fullReads(), 1);
  f.advance(1); await f.client.refreshLearningOnFocus();
  assert.equal(f.fullReads(), 2);
});

test('pending answers flush immediately on fresh focus and failed writes remain retryable', async () => {
  const f = fixture(); await f.client.setLearningOwner('alice');
  const command = { owner: 'alice', commandId: 'same-command', action: 'answers', answers: [{ question_id: 1, selected_answer: 'A', event_id: 'same-event' }] };
  f.values.set('learningOutbox:alice', JSON.stringify([command]));
  f.state.failPost = true;
  await f.client.refreshLearningOnFocus();
  assert.deepEqual(JSON.parse(f.values.get('learningOutbox:alice')), [command]);
  assert.equal(f.client.getLearningStatus(), 'error');
  f.state.failPost = false;
  await f.client.refreshLearningOnFocus();
  assert.deepEqual(JSON.parse(f.values.get('learningOutbox:alice')), []);
  assert.deepEqual(f.calls.filter(c => c.method === 'POST').map(c => c.body), [command, command]);
  assert.equal(f.client.getLearningStatus(), 'ready');
});

test('online/manual retry and newly recorded answers bypass the focus stale window', async () => {
  const f = fixture(); await f.client.setLearningOwner('alice');
  await f.client.retryLearning(); assert.equal(f.fullReads(), 2);
  f.client.recordLearning([{ question_id: 1, selected_answer: 'A' }]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(f.fullReads(), 3);
  assert.deepEqual(JSON.parse(f.values.get('learningOutbox:alice')), []);
});

test('failed read is retried on next focus; repeated stale focus shares one pending retry', async () => {
  const f = fixture(); await f.client.setLearningOwner('alice');
  f.advance(300000); f.state.failGet = true;
  await f.client.refreshLearningOnFocus(); assert.equal(f.client.getLearningStatus(), 'error');
  f.state.failGet = false;
  let release;
  f.state.hold = new Promise(resolve => { release = resolve; });
  const pending = Array.from({ length: 5 }, () => f.client.refreshLearningOnFocus());
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(f.fullReads(), 3);
  release(); await Promise.all(pending);
  assert.equal(f.client.getLearningStatus(), 'ready');
});

test('midnight and clock rollback invalidate fresh focus reads', async () => {
  const f = fixture();
  f.advance(4 * 60 * 60 * 1000 - 1000); await f.client.setLearningOwner('alice');
  f.advance(1001); await f.client.refreshLearningOnFocus(); assert.equal(f.fullReads(), 2);
  f.advance(-2000); await f.client.refreshLearningOnFocus(); assert.equal(f.fullReads(), 3);
});

test('failed migration is retried even when full reads succeeded', async () => {
  const f = fixture(); f.values.delete('learningMigrated:alice'); f.state.failPost = true;
  await f.client.setLearningOwner('alice'); assert.equal(f.client.getLearningStatus(), 'error');
  f.state.failPost = false; await f.client.refreshLearningOnFocus();
  assert.equal(f.values.get('learningMigrated:alice'), '1');
  assert.equal(f.calls.filter(c => c.body?.action === 'import').length, 2);
  assert.equal(f.client.getLearningStatus(), 'ready');
});

test('account switch and logout ignore late focus data without carrying freshness across accounts', async () => {
  const f = fixture(); await f.client.setLearningOwner('alice'); f.advance(300000);
  let release; f.state.hold = new Promise(resolve => { release = resolve; });
  const pending = f.client.refreshLearningOnFocus();
  await new Promise(resolve => setTimeout(resolve, 0));
  f.state.owner = 'bob'; f.state.hold = null;
  await f.client.setLearningOwner('bob');
  release(); await pending;
  assert.equal(f.client.getLearning().owner, 'bob');
  assert.equal(f.fullReads(), 3);
  await f.client.setLearningOwner(null); await f.client.refreshLearningOnFocus();
  assert.equal(f.client.getLearning(), null); assert.equal(f.fullReads(), 3);
});

test('LearningSync routes focus and online to separate handlers and cleans both up', () => {
  const effects = [], events = new Map(), calls = [];
  const source = readFileSync(new URL('../components/LearningSync.tsx', import.meta.url), 'utf8');
  const exports = {};
  const mocks = {
    react: { useEffect: fn => effects.push(fn) },
    '@/lib/auth-client': { authClient: { useSession: () => ({ data: { user: { id: 'alice' } }, isPending: false }) } },
    '@/lib/learning-client': { setLearningOwner: id => calls.push(id), retryLearning: () => calls.push('online'), refreshLearningOnFocus: () => calls.push('focus') },
  };
  new Function('exports', 'require', 'window', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(exports, name => mocks[name], { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: (name, fn) => { assert.equal(events.get(name), fn); events.delete(name); } });
  exports.default(); effects[0](); const cleanup = effects[1]();
  events.get('focus')(); events.get('online')();
  assert.deepEqual(calls, ['alice', 'focus', 'online']); cleanup(); assert.equal(events.size, 0);
});
