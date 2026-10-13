// In-memory PostgreSQL only. Never reads .env files or connects to DATABASE_URL.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export function load(path, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name === 'server-only' || name.endsWith('.css')) return {};
    if (name in mocks) return mocks[name];
    if (name.startsWith('node:') || name.startsWith('react')) return require(name);
    throw Error('Unexpected import ' + name);
  }, exports);
  return exports;
}
export const input = load('lib/admin-question-input.ts');
export const adminService = load('lib/admin-questions.ts', { './admin-question-input': input });
export const service = load('lib/official-explanation.ts', { './admin-question-input': input, './admin-questions': adminService });
export const http = load('lib/admin-question-http.ts', { 'next/server': { NextResponse: Response }, './admin-questions': adminService });

export async function fixture() {
  const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(`CREATE TABLE question_sets (id int PRIMARY KEY,name text,exam_year int,exam_subject text,visibility text);
    CREATE TABLE questions (id int PRIMARY KEY,question_set_id int REFERENCES question_sets(id),kind text DEFAULT 'exam',
      question_number int,subject text,question text,option_a text,option_b text,option_c text,option_d text,option_e text,answer text,explanation text);
    CREATE TABLE question_answer_stats (id int PRIMARY KEY,question_id int REFERENCES questions(id),selected_answer text);
    CREATE TABLE ai_questions (id text PRIMARY KEY,content jsonb);
    INSERT INTO question_sets VALUES (1,'測試國考題庫',2026,'獸醫病理學','public'),(2,'私人題庫',NULL,'獸醫病理學','private');
    INSERT INTO questions VALUES (1,1,'exam',1,'獸醫病理學','本機測試題目一','選項甲','選項乙','選項丙','選項丁',NULL,'C',NULL),
      (2,1,'exam',2,'獸醫病理學','本機測試題目二','甲','乙','丙','丁',NULL,'B','既有解析不能遺失'),
      (3,2,'exam',1,'獸醫病理學','私人測試題','甲','乙','丙','丁',NULL,'A','私人解析'),
      (4,1,'ai',4,'獸醫病理學','錯誤題型測試','甲','乙','丙','丁',NULL,'D','不可更新');
    INSERT INTO question_answer_stats VALUES (1,1,'A');
    INSERT INTO ai_questions VALUES ('1','{"explanation":"獸醫練功房原解析"}');`);
  const sql = { query: async (text, values) => (await db.query(text, values)).rows };
  // Exercise the real guard; only its external auth/session and Neon transport are replaced.
  process.env.ADMIN_USER_ID = 'fixture-admin';
  process.env.DATABASE_URL = 'postgresql://unused@127.0.0.1:1/never_connect';
  const admin = load('lib/admin.ts', {
    '@/lib/auth': { auth: { api: { getSession: async ({ headers }) => {
      const id = headers.get('x-fixture-user'); return id ? { user: { id } } : null;
    } } } },
    '@neondatabase/serverless': { neon: () => sql },
  });
  const routes = { '@/lib/admin': admin, '@/lib/admin-question-http': http, '@/lib/official-explanation': service,
    '@/lib/admin-questions': adminService, '@/lib/question-transaction': { questionTransaction: run => db.transaction(tx => run(tx)) } };
  return { db, sql, route: load('app/api/admin/questions/explanation/route.ts', routes),
    list: load('app/api/admin/questions/route.ts', routes),
    save: data => db.transaction(tx => service.saveExplanation(tx, service.parseExplanation(data))),
    close: () => db.close() };
}
