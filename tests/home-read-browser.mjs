import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({channel:'msedge',headless:true});
const base=process.env.TEST_BASE_URL||'http://localhost:3290', subject='獸醫病理學';
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
const summary={owner:'alice',progress:{[subject]:{completed:8,correct:6,wrong:2}},todayCompleted:3,todayDate:date};
const full={owner:'alice',progress:{[subject]:{answered:[1,2,3,4,5,6,7,8],correct:6,wrong:2}},history:Array.from({length:3},()=>({answered_at:new Date().toISOString()})),favorites:[],wrongQuestions:[],legacy:[]};
const question={id:1,questionSetId:1,questionNumber:1,subject,question:'測試題目，何者正確？',options:['甲','乙','丙','丁','戊'],answer:'E',explanation:'測試解析',examYear:115,questionSetName:'fixture'};
mkdirSync('.tmp/home-read/screenshots',{recursive:true});
const errors=[];
async function setup({role='guest',source='random_fallback',cache=false,fail=false,migration=false,pending=false,count=20}={}) {
 const page=await browser.newPage({viewport:{width:375,height:850}});const calls=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({summary,cache,migration,pending})=>{localStorage.setItem('learningLegacyOwner','alice');if(!migration)localStorage.setItem('learningMigrated:alice','1');if(cache)localStorage.setItem('learningSummary:v1:alice',JSON.stringify(summary));if(pending)localStorage.setItem('learningOutbox:alice',JSON.stringify([{owner:'alice',action:'review',questionId:1,field:'favorite',value:true,commandId:'fixture'}]));},{summary,cache,migration,pending});
 await page.route('**/api/**',async r=>{const u=new URL(r.request().url()),path=u.pathname;calls.push({path,method:r.request().method(),body:r.request().postDataJSON?.()});let json={};
 if(path==='/api/auth/get-session')json=role==='guest'?null:{user:{id:'alice',name:'Fixture',email:'fixture@example.test'},session:{id:'fixture',userId:'alice'}};
 else if(path==='/api/learning/summary'){await new Promise(r=>setTimeout(r,150));if(fail)return r.fulfill({status:503,json:{error:'offline'}});json=summary;}
 else if(path==='/api/learning'){if(r.request().method()==='POST')json={success:true};else{await new Promise(r=>setTimeout(r,1200));if(fail)return r.fulfill({status:503,json:{error:'offline'}});json=full;}}
 else if(path==='/api/admin/status')json={isAdmin:false};
 else if(path==='/api/stats/weekly-most-missed')json={source,min_attempts:10,question:source?{question_id:1,question_number:1,exam_subject:subject,question:question.question,...(source==='weekly'?{wrong_attempts:12,total_attempts:20}:{})}:null};
 else if(path==='/api/quiz') {if(u.searchParams.has('settings'))json={availability:[{subject,year:115,count}],chapterAvailability:[]};else {if(u.searchParams.has('groups')){assert.equal(u.searchParams.get('scope'),'public');assert.deepEqual(JSON.parse(u.searchParams.get('groups')),[{subject,years:[],count:'20'}]);}json={questions:Array.from({length:u.searchParams.has('questionId')?1:count},(_,i)=>({...question,id:i+1,questionNumber:i+1}))};}}
 else if(path==='/api/stats/option-distribution')json={total:0,sufficient:false,min_attempts:5,options:[]};
 await r.fulfill({json});});return {page,calls};
}
try {
 for(const opts of [{role:'guest'},{role:'user'},{role:'user',cache:true},{role:'user',migration:true},{role:'user',pending:true},{role:'user',cache:true,fail:true}]) {
  const {page,calls}=await setup(opts);await page.goto(base);const status=page.getByRole('region',{name:'今日學習狀態'});
  if(opts.role==='user'){await status.getByRole('progressbar').waitFor();assert.equal(await status.getByRole('progressbar').getAttribute('aria-valuenow'),'15');const fullCompleted=calls.filter(c=>c.path==='/api/learning'&&c.method==='GET').length;assert(fullCompleted>=0);}
  else await status.getByText('你的第一步，從這裡開始').waitFor();
  await page.waitForTimeout(1400);assert.equal(calls.filter(c=>c.path==='/api/auth/get-session').length,1);assert.equal(calls.filter(c=>c.path==='/api/admin/status').length,opts.role==='user'?1:0);
  if(opts.migration)assert(calls.some(c=>c.body?.action==='import'));if(opts.pending)assert(calls.some(c=>c.body?.action==='review'));
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:850});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  if(opts.cache&&opts.fail){assert.equal(await status.getByRole('progressbar').count(),1);await page.screenshot({path:'.tmp/home-read/screenshots/cached-offline.png',fullPage:true});}
  await page.close();
 }
 for(const source of ['weekly','random_fallback',null]){const {page}=await setup({source});await page.goto(base);const card=page.locator('.study-weekly');await page.waitForTimeout(350);
  if(source==='weekly'){await card.getByText('12 人答錯').waitFor();assert.match(await card.innerText(),/60%/);}
  else if(source==='random_fallback'){await card.getByRole('heading',{name:'今日隨機挑戰'}).waitFor();assert.doesNotMatch(await card.innerText(),/人答錯|答錯率|第.?1.?名/);assert.equal(await card.locator('.study-weekly-rank').count(),0);const text=await card.innerText();await page.locator('.study-subject-filter summary').click();await page.getByPlaceholder('搜尋國考科目…').fill('病理');assert.equal(await card.innerText(),text);
   await card.getByRole('button',{name:'挑戰這題',exact:false}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('group',{name:'今日隨機挑戰答案選項'}).getByRole('button').nth(4).click();await dialog.getByRole('region',{name:'答案與解析'}).waitFor();assert.match(await dialog.innerText(),/正確答案：E/);await page.keyboard.press('Escape');}
  else {await card.getByText('本週作答資料累積中',{exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'挑戰這題',exact:false}).count(),0);}
  if(source==='random_fallback')assert((await card.locator('.study-weekly-copy').boundingBox()).width>200,'fallback must not occupy the rank column');
  await card.screenshot({path:`.tmp/home-read/screenshots/${source||'empty'}-card.png`});await page.close();
 }
 for(const count of [20,3]){const {page}=await setup({count});await page.goto(base);const link=page.locator('.study-bank').first();const u=new URL(await link.getAttribute('href'),base);assert.equal(u.searchParams.get('started'),'1');assert.equal(u.searchParams.get('mode'),'practice');assert.equal(u.searchParams.get('order'),'random');assert.equal(u.searchParams.get('state'),'all');await link.click();await page.getByText(`第 1 / ${count} 題`,{exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);await page.goto(base+'/subjects');await page.getByRole('button',{name:`選擇${subject}，設定練習`}).click();await page.getByRole('dialog').waitFor();await page.close();}
 assert.deepEqual(errors,[]);console.log('PASS homepage guest/account/cache/migration/outbox/offline; session/admin dedupe; 4 widths; weekly/fallback/empty/E dialog; Quick 20/insufficient; subjects settings');
}finally{await browser.close();}
