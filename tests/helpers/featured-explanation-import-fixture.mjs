import { fixture, load, input, adminService, service, http } from './official-explanation-fixture.mjs';
export const contract = load('lib/featured-explanation-import-input.ts');
export const batch = load('lib/featured-explanation-import.ts', {
  './admin-questions': adminService, './admin-question-input': input,
  './official-explanation': service, './featured-explanation-import-input': contract,
});
export async function importFixture() {
  const f = await fixture();
  process.env.BETTER_AUTH_SECRET = 'local-import-test-secret-only-at-least-32-characters';
  await f.db.exec(`INSERT INTO questions(id,question_set_id,question_number,question,option_a,option_b,option_c,option_d,answer)
    SELECT n,1,n,'Fixture question '||n,'A option','B option','C option','D option','C' FROM generate_series(10,69) n;
    UPDATE questions SET explanation_status='published' WHERE id=4;`);
  const admin = load('lib/admin.ts', {
    '@/lib/auth': { auth: { api: { getSession: async ({headers}) => {
      const id=headers.get('x-fixture-user'); return id ? {user:{id}} : null;
    } } } }, '@neondatabase/serverless': { neon: () => f.sql },
  });
  const route = load('app/api/admin/questions/explanation/import/route.ts', {
    '@/lib/admin': admin, '@/lib/admin-question-http': http, '@/lib/admin-questions': adminService,
    '@/lib/featured-explanation-import': batch,
    '@/lib/question-transaction': { questionTransaction: run => f.db.transaction(tx => run(tx)) },
  });
  const call = async (body, user = 'fixture-admin', headers = {}) => {
    const response = await route.POST(new Request('http://localhost/api/admin/questions/explanation/import', {
      method:'POST', headers: {'content-type':'application/json', ...(user ? {'x-fixture-user':user} : {}), ...headers}, body: typeof body==='string' ? body : JSON.stringify(body),
    }));
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  return { ...f, batchRoute: route, call };
}
export const item = (questionId, changes={}) => ({ questionId, expectedAnswer:'C', explanation:'### 核心考點\n\n**中文** pharmacokinetics\n\n- 理由\n\n|選項|理由|\n|---|---|\n|C|測試用解析|', ...changes });
export const selections = preview => preview.rows.filter(r=>r.category==='ready').map(r=>({index:r.index,token:r.token}));
