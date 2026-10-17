// Isolated PostgreSQL only. No .env, remote database or production account.
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {fixture as base} from './multiple-answers-fixture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
export function loadCoach(path,mocks={},cache=new Map()){
 const file=resolve(root,path);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','exports',code)(name=>{if(name==='server-only')return{};if(name in mocks)return mocks[name];
  const target=name.startsWith('@/')?resolve(root,name.slice(2)):name.startsWith('.')?resolve(dirname(file),name):null;
  if(target&&existsSync(target+'.ts'))return loadCoach(target+'.ts',mocks,cache);return require(name);
 },exports);return exports;
}
export const rules=loadCoach('lib/coach-daily.ts'),daily=loadCoach('lib/daily-task-service.ts'),diagnostic=loadCoach('lib/diagnostic-service.ts'),evidence=loadCoach('lib/coach-daily-service.ts'),taxonomy=loadCoach('data/exam-chapters.ts');
export async function fixture(){
 const f=await base();
 for(const name of ['20260915_diagnostic_confirmation.sql','20260916_reinforcement_tasks.sql','20260917_follow_ups.sql','20260918_daily_tasks.sql','20260919_custom_plans.sql','20261017_coach_daily_plan.sql','20261017_coach_personalization.sql'])await f.db.exec(readFileSync(resolve(root,'migrations',name),'utf8'));
 const rows=taxonomy.EXAM_SUBJECTS.flatMap((subject,s)=>Array.from({length:20},(_,n)=>({id:100+s*100+n,subject,chapter:taxonomy.chapterGroups(subject)[0].chapters[n<10?0:1]})));
 await f.query(`INSERT INTO questions(id,question_set_id,question_number,subject,chapter,question,option_a,option_b,option_c,option_d,answer,explanation,explanation_status)
  SELECT id,1,id,subject,chapter,'教練測試題：'||id,'正確選項','其他選項','第三選項','第四選項','A','### 保存解析','published' FROM jsonb_to_recordset($1::jsonb) AS r(id int,subject text,chapter text)`,[JSON.stringify(rows)]);
 await f.query("INSERT INTO questions(id,question_set_id,kind,subject,question,option_a,option_b,answer) VALUES(9000,1,'ai','獸醫病理學','禁止 AI 混入','甲','乙','A'),(9001,2,'exam','獸醫病理學','禁止私人題混入','甲','乙','A')");
 const transaction=run=>f.db.transaction(tx=>run(tx));
 const mocks={'next/server':{NextResponse:Response},'@/lib/auth':{auth:{api:{getSession:async({headers})=>{const id=headers.get('x-test-user');return id?{user:{id}}:null;}}}},'@/lib/question-transaction':{questionTransaction:transaction}};
 const route=loadCoach('app/api/study-plan/daily/route.ts',mocks),diagnosticRoute=loadCoach('app/api/study-plan/diagnostic/route.ts',mocks);
 const seed=async(user='a')=>{
  for(const [index,r] of rows.filter((r,i)=>i%20<6).entries())await f.query("INSERT INTO practice_attempts(user_id,event_id,question_id,selected_answer,is_correct,answered_at,mode) VALUES($1,$2,$3,$4,$5,CURRENT_TIMESTAMP-interval '2 days','practice')",[user,randomUUID(),r.id,index<6?'B':'A',index>=6]);
 };
 const coachRoute=loadCoach('app/api/study-plan/coach/route.ts',mocks);
 return {...f,rows,transaction,route,diagnosticRoute,coachRoute,seed,ensure:user=>transaction(tx=>daily.ensureDailyTask(tx,user)),read:user=>transaction(tx=>daily.readDailyTask(tx,user)),answer:(user,taskId,position,answer='A')=>transaction(tx=>daily.answerDailyTask(tx,user,{taskId,position,answer}))};
}
