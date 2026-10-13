import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fixture, service, load } from './helpers/official-explanation-fixture.mjs';

const payload = (saved, action, explanation = saved.explanation) => ({ id: saved.id, revision: saved.revision, explanation, action, ...(action === 'publish' ? { confirmReview: true } : {}) });
const migration = readFileSync(new URL('../migrations/20261014_featured_explanations.sql', import.meta.url), 'utf8');
const adminRequest = path => new Request('http://localhost/api/admin/questions' + path, { headers: { 'x-fixture-user': 'fixture-admin' } });

function publicRoutes(f, user = null) {
  // Neon tagged queries compose fragments lazily, just like the real driver.
  function sql(strings, ...values) {
    let text = '', params = [];
    strings.forEach((string, i) => {
      text += string;
      if (i < values.length) {
        const value = values[i];
        if (value && typeof value.text === 'string') {
          text += value.text.replace(/\$(\d+)/g, (_, n) => '$' + (Number(n) + params.length)); params.push(...value.params);
        } else { params.push(value); text += '$' + params.length; }
      }
    });
    return { text, params, then: (resolve, reject) => f.db.query(text, params).then(r => r.rows).then(resolve, reject) };
  }
  const mocks = {
    'next/server': { NextResponse: Response }, '@neondatabase/serverless': { neon: () => sql },
    '@/lib/auth': { auth: { api: { getSession: async () => user ? { user: { id: user } } : null } } },
    '@/data/exam-chapters': { validChapter: () => true },
    '@/lib/question-state': { QUESTION_STATES: ['all'] }, '@/lib/question-transaction': {}, '@/lib/learning-service': {}, '@/lib/home-public-data': {},
  };
  return {
    quiz: load('app/api/quiz/route.ts', mocks), questions: load('app/api/questions/route.ts', mocks),
    set: load('app/api/question-sets/[id]/questions/route.ts', mocks),
    detail: load('lib/question-detail-answer.ts', { './question-answer': load('lib/question-answer.ts'), './question-stats': { recordFirstAnswers: async () => {} } }),
  };
}

test('migration preserves existing bodies, defaults to unpublished, is idempotent and can roll back', async () => {
  const f = await fixture();
  try {
    const before = await f.sql.query('SELECT * FROM questions ORDER BY id', []);
    assert.equal((await service.readExplanation(f.sql.query, 2)).status, 'draft');
    assert.equal((await service.readExplanation(f.sql.query, 1)).status, 'unwritten');
    await f.db.exec(migration); assert.deepEqual(await f.sql.query('SELECT * FROM questions ORDER BY id', []), before);
    await f.db.exec('ALTER TABLE questions DROP COLUMN explanation_status, DROP COLUMN explanation_version');
    // New reads are safe even before migration (deploy readers first).
    const routes = publicRoutes(f);
    const result = await routes.quiz.GET(new Request('http://localhost/api/quiz?scope=public&questionId=2'));
    assert.equal(result.status, 200); assert.equal((await result.json()).questions[0].explanation, '');
    await assert.rejects(f.db.transaction(async tx => { await tx.exec(migration); throw Error('rollback'); }), /rollback/);
    assert.equal((await f.sql.query("SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name='questions' AND column_name='explanation_status'", []))[0].n, 0);
    assert.equal((await f.sql.query('SELECT explanation FROM questions WHERE id=2', []))[0].explanation, '既有解析不能遺失');
  } finally { await f.close(); }
});

test('draft -> reviewed publish -> edit draft -> republish -> unpublish; stale and empty publication rejected', async () => {
  const f = await fixture();
  try {
    let row = await service.readExplanation(f.sql.query, 1);
    row = await f.save(payload(row, 'draft', '### 正確答案：A\n\n這段文字不得修改題庫答案 C'));
    assert.equal(row.status, 'draft');
    const stale = row;
    assert.throws(() => service.parseExplanation({ ...payload(row, 'publish'), confirmReview: false }), /人工核對/);
    row = await f.save(payload(row, 'publish')); assert.equal(row.status, 'published');
    const published = row;
    row = await f.save(payload(row, 'draft', row.explanation + '\n修正'));
    assert.equal(row.status, 'draft');
    await assert.rejects(f.save(payload(stale, 'publish', '舊資料覆蓋')), { status: 409 });
    row = await f.save(payload(row, 'publish')); assert.equal(row.status, 'published');
    // Cancel cannot overwrite the stored body using an arbitrary submitted text.
    const body = row.explanation;
    row = await f.save(payload(row, 'unpublish', 'must not replace')); assert.equal(row.explanation, body); assert.equal(row.status, 'draft');
    await assert.rejects(f.save(payload(published, 'unpublish')), { status: 409 });
    assert.equal((await f.sql.query('SELECT answer FROM questions WHERE id=1', []))[0].answer, 'C');
    assert.throws(() => service.parseExplanation(payload(row, 'publish', '')), /請填寫/);
    assert.throws(() => service.parseExplanation({ ...payload(row, 'publish'), status: 'published' }), /只允許/);
    assert.throws(() => service.parseExplanation({ ...payload(row, 'publish'), action: ['publish'] }), /操作無效/);
    for (const action of ['publish','unpublish','draft']) for (const user of [null,'member']) {
      const response = await f.route.PATCH(new Request('http://localhost/api/admin/questions/explanation', { method: 'PATCH', headers: { 'content-type': 'application/json', ...(user ? { 'x-fixture-user': user } : {}) }, body: JSON.stringify(payload(row, action)) }));
      assert.equal(response.status, 403);
    }
  } finally { await f.close(); }
});

test('all public question APIs hide drafts and revoked content; private and AI bodies remain untouched', async () => {
  const f = await fixture();
  try {
    const routes = publicRoutes(f), member = publicRoutes(f, 'member');
    const read = async expected => {
      for (const route of [routes, member]) {
        for (const path of ['?scope=public&questionId=2', '?subjects=' + encodeURIComponent('獸醫病理學')]) {
          const response = await route.quiz.GET(new Request('http://localhost/api/quiz' + path));
          assert.equal(response.status, 200); const rows = (await response.json()).questions;
          assert.equal(rows.find(q => q.id === 2).explanation, expected);
          if (rows.some(q => q.id === 3)) assert.equal(rows.find(q => q.id === 3).explanation, '私人解析');
        }
        const response = await route.questions.GET(new Request('http://localhost/api/questions?subject=' + encodeURIComponent('獸醫病理學')));
        assert.equal(response.status, 200); assert.equal((await response.json()).questions.find(q => q.id === 2).explanation, expected);
        const set = await route.set.GET(new Request('http://localhost/api/question-sets/1/questions'), { params: Promise.resolve({ id: '1' }) });
        assert.equal(set.status, 200); assert.equal((await set.json()).questions.find(q => q.id === 2).explanation, expected);
      }
      const answer = await f.db.transaction(tx => routes.detail.answerPublicQuestion(tx, null, { question_id: 2, selected_answer: 'B' }));
      assert.equal(answer.body.explanation, expected); assert.equal(answer.body.answer, 'B'); assert.equal(answer.body.correct, true);
    };
    await read('');
    let row = await f.save(payload(await service.readExplanation(f.sql.query, 2), 'publish'));
    await read('既有解析不能遺失');
    await f.save(payload(row, 'unpublish')); await read('');
    const privateSet = await member.set.GET(new Request('http://localhost/api/question-sets/2/questions'), { params: Promise.resolve({ id: '2' }) });
    assert.equal((await privateSet.json()).questions[0].explanation, '私人解析');
    assert.equal((await f.sql.query('SELECT content FROM ai_questions', []))[0].content.explanation, '獸醫練功房原解析');
  } finally { await f.close(); }
});

test('admin status filters and actual bank completion counts', async () => {
  const f = await fixture();
  try {
    for (const [status, ids] of [['unwritten',[1]],['draft',[2]],['published',[]]]) {
      const response = await f.list.GET(adminRequest('?explanation_status=' + status));
      assert.equal(response.status, 200); assert.deepEqual((await response.json()).questions.map(q => q.id), ids);
    }
    await f.save(payload(await service.readExplanation(f.sql.query, 2), 'publish'));
    const list = await (await f.list.GET(adminRequest('?explanation_status=published'))).json();
    assert.deepEqual(list.questions.map(q => q.id), [2]);
    assert.equal(list.sets.find(s => s.id === 1).published_explanations, 1);
    assert.equal(list.sets.find(s => s.id === 1).explanation_total, 2);
    assert.equal((await f.list.GET(adminRequest('?explanation_status=invalid'))).status, 400);
  } finally { await f.close(); }
});

test('coach/review SQL gates and imported learning archives cannot expose revoked explanation copies', async () => {
  const f = await fixture();
  try {
    for (const file of ['lib/learning-service.ts','lib/due-review-service.ts','lib/daily-task-service.ts','lib/custom-plan-service.ts']) {
      const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
      const projection = source.match(/CASE WHEN to_jsonb\(q\)->>'explanation_status'='published' THEN (?:COALESCE\(q.explanation,''\)|q.explanation) ELSE '' END AS explanation/)?.[0];
      assert(projection, file);
      const query = `SELECT ${projection} FROM questions q WHERE id=2`;
      assert.equal((await f.sql.query(query, []))[0].explanation, '');
    }
    const legacy = load('lib/featured-explanation-legacy.ts');
    const archive = [{ favorites: [{ id: 2, explanation: 'stale secret', note: 'keep' }, { id: 3, explanation: 'private copy' }], wrongQuestions: [{ id: '2', explanation: 'old' }], progress: { keep: true } }];
    const original = structuredClone(archive);
    const safe = await legacy.publicLegacyExplanations(f.db, archive);
    assert.equal(safe[0].favorites[0].explanation, ''); assert.equal(safe[0].wrongQuestions[0].explanation, '');
    assert.equal(safe[0].favorites[1].explanation, 'private copy'); assert.equal(safe[0].favorites[0].note, 'keep');
    assert.deepEqual(archive, original);
    await f.save(payload(await service.readExplanation(f.sql.query, 2), 'publish'));
    assert.equal((await legacy.publicLegacyExplanations(f.db, archive))[0].favorites[0].explanation, '既有解析不能遺失');
  } finally { await f.close(); }
});
