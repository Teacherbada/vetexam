// Ephemeral PostgreSQL only. Never loads .env or connects to Neon.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import * as fsrs from 'ts-fsrs';
import {load,input,adminService} from './official-explanation-fixture.mjs';
export {load,input,adminService};
export const answers=load('lib/question-answer.ts');
export const years=load('lib/exam-year.ts');
export const stats=load('lib/question-stats.ts');
export const taxonomy=load('data/exam-chapters.ts');
const diagnostic=load('lib/diagnostic.ts',{'../data/exam-chapters':taxonomy});
export const coach=load('lib/diagnostic-service.ts',{'@/data/exam-chapters':taxonomy,'@/lib/question-stats':stats,'@/lib/diagnostic':diagnostic});
const memory=load('lib/question-memory-service.ts',{'ts-fsrs':fsrs});
export const learning=load('lib/learning-service.ts',{'./question-stats':stats,'./question-state':load('lib/question-state.ts'),'./question-memory-service':memory,'./featured-explanation-legacy':load('lib/featured-explanation-legacy.ts')});
export const detail=load('lib/question-detail-answer.ts',{'./question-stats':stats});
export const classification=load('lib/chapter-classification.ts',{'../data/exam-chapters':taxonomy});
export const batches=load('lib/pdf-batch-import.ts',{'./import-batches':load('lib/import-batches.ts'),'./chapter-classification':classification});
const migration=name=>readFileSync(new URL('../../migrations/'+name,import.meta.url),'utf8');
export async function fixture(){
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href),db=new PGlite();
 await db.exec(`CREATE TABLE "user"(id text PRIMARY KEY);
  INSERT INTO "user" VALUES('admin'),('a'),('b'),('c');
  CREATE TABLE study_plans(user_id text PRIMARY KEY REFERENCES "user"(id), mode text DEFAULT 'coach');
  INSERT INTO study_plans(user_id) SELECT id FROM "user";
  CREATE TABLE question_sets(id serial PRIMARY KEY,name text,filename text,total_questions int,file_hash text,visibility text,owner_id text,exam_subject text,exam_year int);
  CREATE TABLE questions(id serial PRIMARY KEY,question_set_id int REFERENCES question_sets(id),kind text DEFAULT 'exam',question_number int,subject text,chapter text,
   question text,option_a text,option_b text,option_c text,option_d text,option_e text,answer text DEFAULT '',explanation text DEFAULT '',image_data_url text);
  CREATE TABLE question_answer_stats(id serial PRIMARY KEY,user_id text,question_id int REFERENCES questions(id),selected_answer text,is_correct boolean,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(user_id,question_id));
  INSERT INTO question_sets(name,visibility,owner_id,exam_year) VALUES('Exam','public','admin',2026),('Private','private','a',2026);
  INSERT INTO questions(question_set_id,question_number,subject,question,option_a,option_b,option_c,option_d,answer) VALUES
   (1,1,'獸醫病理學','single','甲','乙','丙','丁','A'),(1,2,'獸醫病理學','multiple','甲','乙','丙','丁','["A","B"]'),
   (1,3,'獸醫病理學','legacy','甲','乙','丙','丁','C'),(2,1,'獸醫病理學','private','甲','乙','丙','丁','D');
  CREATE TABLE ai_questions(id text PRIMARY KEY,content jsonb);INSERT INTO ai_questions VALUES('1','{"answer":"C"}');`);
 await db.exec(migration('20260914_initial_diagnostic.sql'));
 await db.exec(`ALTER TABLE diagnostic_sessions DROP CONSTRAINT diagnostic_sessions_user_id_key;
  ALTER TABLE diagnostic_sessions ADD COLUMN kind text DEFAULT 'initial',ADD COLUMN parent_session_id uuid,ADD COLUMN reinforcement_task_id uuid,ADD COLUMN verification_metadata jsonb;`);
 for(const name of ['20260925_account_learning.sql','20260925_question_memory_state.sql','20261014_featured_explanations.sql','20260912_pdf_batch_imports.sql','20261014_multiple_official_answers.sql']) await db.exec(migration(name));
 const query=async(text,values=[]) =>(await db.query(text,values)).rows;
 // Real tagged Neon query composition and transactions; transport is in-memory.
 function sql(strings,...values){let text='',params=[];strings.forEach((part,i)=>{text+=part;if(i<values.length){params.push(values[i]);text+='$'+params.length;}});return {text,params,then:(resolve,reject)=>db.query(text,params).then(r=>r.rows).then(resolve,reject)};}
 sql.query=query;sql.transaction=operations=>db.transaction(async tx=>{const result=[];for(const op of operations)result.push((await tx.query(op.text,op.params)).rows);return result;});
 const mocks={'next/server':{NextResponse:Response},'@neondatabase/serverless':{neon:()=>sql},'@/lib/auth':{auth:{api:{getSession:async({headers})=>{const id=headers.get('x-test-user');return id?{user:{id}}:null;}}}},'@/lib/subscription':{hasProAccess:async()=>true},'@/data/exam-chapters':taxonomy,'@/lib/chapter-classification':classification};
 process.env.ADMIN_USER_ID='admin';process.env.DATABASE_URL='postgresql://unused@127.0.0.1:1/never_connect';process.env.BETTER_AUTH_SECRET='isolated-test-signing-key-at-least-32-characters';
 const routes={manual:load('app/api/manual-questions/route.ts',mocks),sets:load('app/api/question-sets/route.ts',mocks),confirm:load('app/api/pdf/confirm/route.ts',mocks)};
 return {db,query,routes,close:()=>db.close(),transaction:run=>db.transaction(tx=>run(tx))};
}
