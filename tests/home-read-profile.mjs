import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import pg from 'pg';
import { execFileSync } from 'node:child_process';
const phase = process.argv[2] || 'before';
const out = '.tmp/home-read'; fs.mkdirSync(out, { recursive: true });
const result = { phase, endpoints: [], queries: [] };
const base = process.env.PROFILE_BASE_URL || 'https://vetexam-tw.vercel.app';
for (const path of (process.env.BROWSER_ONLY ? [] : ['/api/auth/get-session','/api/learning','/api/quiz?scope=public&settings=1&chapters=1','/api/stats/weekly-most-missed','/api/admin/status'])) {
  for (let i=0;i<3;i++) { const start=performance.now(); try {const r=await fetch(base+path);const body=await r.arrayBuffer();result.endpoints.push({path,run:i,status:r.status,ms:Math.round(performance.now()-start),bytes:body.byteLength});} catch {result.endpoints.push({path,error:'network unavailable'});} }
}
// Read the existing connection string without copying env files or exposing values.
const env = fs.readFileSync(process.env.PROFILE_ENV_FILE || '../../.env.local','utf8');
const connectionString = env.match(/^DATABASE_URL\s*=\s*["']?([^\r\n"']+)/m)?.[1];
if(connectionString && !process.env.BROWSER_ONLY) {
 const client=new pg.Client({connectionString,connectionTimeoutMillis:10000});
 try {
  await client.connect(); await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='20s'");
  const indexes=await client.query("SELECT tablename,indexdef FROM pg_indexes WHERE tablename = ANY($1)",[['practice_attempts','question_answer_stats','diagnostic_sessions','diagnostic_items','question_review_state','learning_imports']]);result.indexes=indexes.rows;
  const owners=await client.query('SELECT user_id FROM practice_attempts GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1');
  const user=owners.rows[0]?.user_id;
  const source=phase==='before'?execFileSync('git',['show','3f2c53398dd78ed4749a7ba308721f1ee3a77ee4:lib/learning-service.ts'],{encoding:'utf8'}):fs.readFileSync('lib/learning-service.ts','utf8');
  const exports={};new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>({}),exports);
  const timed={query:async(sql,values)=>{const start=performance.now();const r=await client.query(sql,values);result.queries.push({ms:Math.round(performance.now()-start),rows:r.rowCount,sql});return r;}};
  if(user){let start=performance.now();const full=await exports.readLearning(timed,user);result.full={ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(JSON.stringify(full)),historyRows:full.history.length};if(exports.readLearningSummary){start=performance.now();const summary=await exports.readLearningSummary(timed,user);result.summary={ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(JSON.stringify(summary))};}}
  for(const entry of result.queries){const plan=await client.query('EXPLAIN (FORMAT JSON) '+entry.sql,[user]);entry.plan=JSON.parse(JSON.stringify(plan.rows).replaceAll(user,'[account]'));}
  await client.query('ROLLBACK');
 }catch(e){result.dbError=e.code || e.name;}finally{await client.end();}
}
if(!process.env.BROWSER_ONLY) fs.writeFileSync(`${out}/${phase}-server.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({phase,endpoints:result.endpoints,full:result.full,summary:result.summary,dbError:result.dbError}));
if(process.env.PLAYWRIGHT_MODULE) {
 const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);const browser=await chromium.launch({channel:'msedge',headless:true});
 try {const measurements=[];for(const role of ['guest','user','returning'])for(let run=0;run<3;run++){const page=await browser.newPage();const events=[];
 await page.addInitScript(role=>{localStorage.setItem('learningMigrated:user','1');localStorage.setItem('learningLegacyOwner','user');if(role==='returning')localStorage.setItem('learningSummary:v1:user',JSON.stringify({owner:'user',progress:{'獸醫病理學':{completed:2,correct:1,wrong:1}},todayCompleted:1,todayDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())}));},role);
 const progress={'獸醫病理學':{answered:[1,2],correct:1,wrong:1}};
 await page.route('**/api/**',async r=>{const path=new URL(r.request().url()).pathname;const start=Date.now();const delay=path==='/api/learning'?900:path==='/api/learning/summary'?100:150;await new Promise(resolve=>setTimeout(resolve,delay));let json={};
 if(path==='/api/auth/get-session')json=role==='guest'?null:{user:{id:'user',email:'test@example.test'},session:{id:'fixture',userId:'user'}};
 if(path==='/api/learning')json={owner:'user',progress,history:[{answered_at:new Date().toISOString()}],favorites:[],wrongQuestions:[],legacy:[]};
 if(path==='/api/learning/summary')json={owner:'user',progress:{'獸醫病理學':{completed:2,correct:1,wrong:1}},todayCompleted:1,todayDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())};
 if(path==='/api/quiz')json={availability:[],chapterAvailability:[]};
 if(path==='/api/stats/weekly-most-missed')json={question:null,min_attempts:10,source:null};
 events.push({path,start,end:Date.now()});await r.fulfill({json});});
 const start=Date.now();await page.goto(process.env.TEST_BASE_URL||'http://localhost:3290');await page.locator('h1').waitFor();const hero=Date.now()-start;
 await page.waitForFunction(()=>{const el=document.querySelector('[aria-labelledby="home-status-title"]');return el&&!el.textContent.includes('讀取學習進度中');});const status=Date.now()-start;await page.waitForTimeout(1200);
 measurements.push({role,run,heroMs:hero,statusMs:status,requests:events.map(e=>({...e,start:e.start-start,end:e.end-start}))});await page.close();}
 fs.writeFileSync(`${out}/${phase}-browser.json`,JSON.stringify(measurements,null,2));console.log(measurements);
 }finally{await browser.close();}
}
