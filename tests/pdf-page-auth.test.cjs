const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the page's asynchronous auth rendering without a real account or DB.
function mount() {
  const slots = [], effects = [], pending = [], requests = [];
  let cursor = 0;
  let session = { data: null, isPending: true };
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const old = effects[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        old?.cleanup?.();
        effects[index] = { deps };
        pending.push(() => { effects[index].cleanup = fn(); });
      }
    },
    useCallback(fn) { cursor++; return fn; },
  };
  const jsx = (type, props) => ({ type, props });
  const context = { exports: {}, console, fetch(url) {
    if (url === '/api/admin/status') return new Promise((resolve, reject) => requests.push({ resolve, reject }));
    return Promise.resolve({ ok: true, json: async () => ({ questionSets: [], subscription: null }) });
  }, require(id) {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    if (id === '@/lib/auth-client') return { authClient: { useSession: () => session } };
    if (id.endsWith('.css')) return { default: new Proxy({}, { get: (_, key) => String(key) }) };
    return { default: 'stub', StudyIcon: 'icon' };
  } };
  const source = fs.readFileSync('app/pdf/page.tsx', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return {
    requests,
    session(data, isPending = false) { session = { data, isPending }; },
    render() {
      cursor = 0;
      const tree = context.exports.default();
      pending.splice(0).forEach(run => run());
      return JSON.stringify(tree);
    },
    async reply(index, isAdmin, ok = true) {
      requests[index].resolve({ ok, json: async () => ({ isAdmin }) });
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('refresh/direct entry waits for session and admin response before showing upload', async () => {
  const page = mount();
  assert.match(page.render(), /正在確認登入與管理員身分/);
  assert.equal(page.requests.length, 0);
  page.session({ user: { id: 'admin', email: 'admin@example.test' } });
  assert.doesNotMatch(page.render(), /沒有權限使用此功能|選擇國考 PDF 檔案/);
  assert.equal(page.requests.length, 1);
  await page.reply(0, true);
  assert.match(page.render(), /選擇國考 PDF 檔案/);
});

test('signed out and non-admin users do not receive upload controls', async () => {
  const page = mount();
  page.session(null);
  assert.match(page.render(), /請先登入管理員帳號/);
  page.session({ user: { id: 'regular' } });
  page.render();
  await page.reply(0, false);
  const tree = page.render();
  assert.match(tree, /沒有權限使用此功能/);
  assert.doesNotMatch(tree, /選擇國考 PDF 檔案/);
});

test('late admin response cannot grant the next account upload access', async () => {
  const page = mount();
  page.session({ user: { id: 'admin' } });
  page.render();
  page.session({ user: { id: 'regular' } });
  page.render();
  await page.reply(1, false);
  await page.reply(0, true);
  assert.doesNotMatch(page.render(), /選擇國考 PDF 檔案/);
  assert.match(page.render(), /沒有權限使用此功能/);
});

test('failed admin lookup never displays upload controls', async () => {
  const page = mount();
  page.session({ user: { id: 'admin' } });
  page.render();
  page.requests[0].reject(new Error('offline'));
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(page.render(), /選擇國考 PDF 檔案|正在確認登入與管理員身分/);
});
