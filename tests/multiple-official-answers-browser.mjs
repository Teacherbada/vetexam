import assert from 'node:assert/strict';
import {mkdir,writeFile,unlink,rmdir,readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {fixture,load,input,adminService,stats} from './helpers/multiple-answers-fixture.mjs';
import {http,service} from './helpers/official-explanation-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href), f=await fixture();
const dir=new URL('../app/multiple-answers-test-fixture/',import.meta.url), artifacts=new URL('../.tmp/multiple-answers-browser/',import.meta.url),base='http://127.0.0.1:3129';
const adminMocks={'@/lib/admin':{requireAdmin:async()=>({session:{user:{id:'admin'}},sql:{query:f.query}})},'@/lib/admin-question-http':http,'@/lib/admin-questions':adminService,'@/lib/admin-question-input':input,'@/lib/question-transaction':{questionTransaction:f.transaction},'@/lib/official-explanation':service};
const list=load('app/api/admin/questions/route.ts',adminMocks), bulk=load('app/api/admin/questions/bulk-answers/route.ts',adminMocks), explanation=load('app/api/admin/questions/explanation/route.ts',adminMocks);
let created=false,server,browser,page,log='';
try{
 await mkdir(dir);created=true;await mkdir(artifacts,{recursive:true});
 await writeFile(new URL('page.tsx',dir),`import Admin from '../admin/questions/QuestionsAdmin';import Manual from '../manual/page';import PDF from '../pdf/page';export default async function Page({searchParams}:{searchParams:Promise<{mode?:string}>}){const mode=(await searchParams).mode;return mode==='manual'?<Manual/>:mode==='pdf'?<PDF/>:<Admin/>;}`);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3129'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'postgresql://unused@127.0.0.1:1/never_connect',BETTER_AUTH_SECRET:'local-test-secret-at-least-32-characters',BETTER_AUTH_URL:base,NEXT_PUBLIC_SITE_URL:base}});
 server.stdout.on('data',c=>log=(log+c).slice(-10000));server.stderr.on('data',c=>log=(log+c).slice(-10000));
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/next.svg')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}assert(ready,log);
 browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const quiz=async id=>{const [q]=await f.query('SELECT * FROM questions WHERE id=$1',[id]);return {id:q.id,questionSetId:1,questionNumber:q.question_number,subject:q.subject,question:q.question,options:[q.option_a,q.option_b,q.option_c,q.option_d],answer:q.answer,explanation:'',examYear:2026,questionSetName:'Fixture'};};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  const handler=p==='/api/admin/questions'?list:p==='/api/admin/questions/bulk-answers'?bulk:p==='/api/admin/questions/explanation'?explanation:null;
  if(handler){const response=await handler[req.method()](new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}: {})}));return route.fulfill({status:response.status,json:await response.json()});}
  if(p==='/api/quiz')return route.fulfill({json:{questions:url.searchParams.get('mode')==='exam'?[await quiz(2),await quiz(3)]:[await quiz(Number(url.searchParams.get('questionId')||2))]}});
  if(p==='/api/stats/answers'){if(req.method()==='POST')await stats.recordFirstAnswers(f.query,'a',req.postDataJSON().answers);return route.fulfill({json:{available:true}});}
  if(p==='/api/stats/option-distribution')return route.fulfill({json:{total:6,sufficient:true,min_attempts:5,options:[{letter:'A',count:2,percentage:33.3},{letter:'B',count:2,percentage:33.3},{letter:'C',count:2,percentage:33.3},{letter:'D',count:0,percentage:0}]}});
  if(p.startsWith('/api/auth/')){await new Promise(r=>setTimeout(r,250));return route.fulfill({json:req.headers().referer?.includes('mode=pdf')?{user:{id:'admin',name:'Admin',email:'admin@example.test'},session:{id:'fixture',userId:'admin',expiresAt:'2099-01-01T00:00:00Z'}}:null});}
  if(p==='/api/admin/status')return route.fulfill({json:{isAdmin:true}});
  if(p==='/api/question-sets')return route.fulfill({json:{questionSets:[]}});
  if(p==='/api/subscription')return route.fulfill({json:{subscription:null}});
  return route.fulfill({status:401,json:{error:'fixture'}});
 });
 for(const [id,letter,correct] of [[1,'A',true],[1,'B',false],[2,'A',true],[2,'B',true],[2,'C',false],[3,'C',true]]){
  await page.goto(base+`/questions?scope=public&started=1&questionId=${id}&mode=practice`);
  const choices=page.getByRole('group',{name:'答案選項'});await choices.getByRole('button').first().waitFor();
  assert.equal(await page.getByRole('region',{name:'答案與解析'}).count(),0);assert.equal(await choices.locator('input[type=checkbox]').count(),0);
  await choices.getByRole('button').nth(letter.charCodeAt(0)-65).click();
  const result=page.getByRole('region',{name:'答案與解析'});await result.waitFor();assert((await result.innerText()).includes(correct?'答對了':'答錯了'));
  if(id===2){assert((await result.innerText()).includes('A、B'));assert.equal(await choices.getByText('✓ 正確答案',{exact:true}).count(),2);}
 }
 for(const width of [320,375,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.goto(base+'/questions?scope=public&started=1&questionId=2&mode=exam');await page.getByRole('group',{name:'答案選項'}).getByRole('button').nth(1).click();
 assert.equal(await page.getByRole('region',{name:'答案與解析'}).count(),0);await page.getByRole('button',{name:'交卷',exact:true}).click();await page.getByRole('heading',{name:'完成這次測驗了'}).waitFor();assert((await page.locator('body').innerText()).includes('1 / 2'));assert((await page.locator('body').innerText()).includes('A、B'));
 await page.evaluate(q=>localStorage.setItem('wrongQuestions',JSON.stringify([q])),await quiz(2));
 await page.goto(base+'/wrong-test');await page.getByRole('group',{name:'答案選項'}).getByRole('button').nth(1).click();await page.getByRole('button',{name:'確認答案'}).click();await page.getByRole('status').filter({hasText:'✓ 答對了'}).waitFor();
 await page.goto(base+'/multiple-answers-test-fixture');await page.getByRole('row').filter({hasText:'#2'}).getByRole('button',{name:'查看／編輯'}).click();
 const newAnswer=page.getByLabel('新的正確答案',{exact:false});assert.equal(await newAnswer.inputValue(),'["A","B"]');await newAnswer.selectOption('["A","B","D"]');await page.getByRole('button',{name:'預覽單題修改'}).click();
 await page.getByRole('button',{name:'確認套用答案'}).waitFor();
 const confirmation=page.getByLabel('我確認套用答案並重新計算歷史統計。');if(await confirmation.count())await confirmation.check();
 await page.getByRole('button',{name:'確認套用答案'}).click();await page.getByRole('status').filter({hasText:'已完成'}).waitFor();assert.equal((await f.query('SELECT answer FROM questions WHERE id=2'))[0].answer,'["A","B","D"]');
 for(const mode of ['manual','pdf']){
  await page.goto(base+'/multiple-answers-test-fixture?mode='+mode);
  const year=mode==='pdf'?page.locator('#exam-year'):page.locator('select').filter({has:page.locator('option[value="2001"]')});
  await year.waitFor();for(const roc of [115,106,105,100,90]){await year.selectOption(String(mode==='pdf'?roc:roc+1911));assert((await year.locator('option:checked').innerText()).includes(String(roc)));}
  if(mode==='manual')assert.equal(await page.locator('option[value=\'["A","B"]\']').count(),1);
  for(const width of [375,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' overflow');await page.screenshot({path:fileURLToPath(new URL(`${mode}-${width}.png`,artifacts)),fullPage:false});}
 }
 assert.deepEqual(errors,[]);console.log('PASS browser: cases 1–6, all accepted choices highlighted, single-choice controls, mock exam, wrong retry, admin edit/preview/save, ROC 90–115 manual/PDF selectors, mobile/desktop');
}catch(error){if(page)console.error((await page.locator('body').innerText()).slice(-2200));console.error(log.slice(-4000));throw error;}
finally{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await f.close();if(created){await unlink(new URL('page.tsx',dir));await rmdir(dir);}for(const p of ['../.next/dev/types/validator.ts','../.next/dev/types/routes.d.ts']){const url=new URL(p,import.meta.url);if((await readFile(url,'utf8').catch(()=>'' )).includes('multiple-answers-test-fixture'))await unlink(url);}}
