// Build current and baseline with dummy local DB/auth settings. Run with
// PLAYWRIGHT_MODULE and LOADING_BASELINE_DIR (the built comparison checkout).
// All browser API calls are isolated fixtures; no production credentials or DB.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),require=createRequire(import.meta.url);
const {PNG}=require(resolve(process.env.PLAYWRIGHT_MODULE,'../../playwright-core/lib/utilsBundle.js'));
const base='http://127.0.0.1:3162',out=resolve('.tmp/brand-loading-browser'),subject='獸醫病理學';
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
const summary={owner:'alice',progress:{[subject]:{completed:8,correct:6,wrong:2}},todayCompleted:3,todayDate:date};
const full={owner:'alice',progress:{[subject]:{answered:[1,2,3,4,5,6,7,8],correct:6,wrong:2}},history:[],favorites:[],wrongQuestions:[],legacy:[]};
const questions=[1,2,3].map(id=>({id,questionSetId:1,questionNumber:id,subject,examYear:2026,questionSetName:'fixture',question:`第 ${id} 題測試題目`,options:['甲','乙','丙','丁'],answer:'["A","B"]',explanation:`第 ${id} 題保存解析`}));
function gate(){let release;const wait=new Promise(r=>release=r);return {wait,release};}
let browser,server,log='';const errors=[],visual=[],screens=new Map();
async function start(cwd){log='';server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3162'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'postgresql://unused@127.0.0.1:1/never_connect',BETTER_AUTH_SECRET:'isolated-browser-secret-at-least-32-characters',BETTER_AUTH_URL:base}});for(const s of [server.stdout,server.stderr])s.on('data',c=>log=(log+c).slice(-12000));for(let i=0;i<100;i++){try{if((await fetch(base+'/next.svg')).ok)return;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,200));}throw Error(log);}
async function stop(){if(!server)return;const s=server;server=null;s.kill();await new Promise(r=>{if(s.exitCode!==null)return r();s.once('exit',r);setTimeout(r,3000);});}
async function setup(config={}){
 const context=await browser.newContext({viewport:{width:config.width??375,height:812},reducedMotion:config.motion??'reduce'}),page=await context.newPage(),calls=[];
 page.setDefaultTimeout(10000);page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',config,page.url(),e.message);});
 await page.addInitScript(({summary,cached})=>{localStorage.setItem('learningLegacyOwner','alice');localStorage.setItem('learningMigrated:alice','1');if(cached)localStorage.setItem('learningSummary:v1:alice',JSON.stringify(summary));},{summary,cached:config.cached});
 await page.route('**/api/**',async r=>{const req=r.request(),u=new URL(req.url()),p=u.pathname;calls.push({path:p,method:req.method(),params:Object.fromEntries(u.searchParams),body:req.postDataJSON()});let json={},status=200;
  if(p.startsWith('/api/auth/')){await config.auth?.wait;json=config.member?{user:{id:'alice',name:'Fixture',email:'fixture@example.test'},session:{id:'fixture',userId:'alice'}}:null;if(config.failAuth){status=503;json={message:'session unavailable'};}}
  else if(p==='/api/quiz'&&u.searchParams.has('settings')){await config.availability?.wait;json={availability:[{subject,year:2026,count:4},{subject,year:2025,count:4}],chapterAvailability:[{subject,year:2026,chapter:'腫瘤',count:4}]};if(config.failAvailability){status=503;json={error:'unavailable'};}}
  else if(p==='/api/quiz'){await config.quiz?.wait;json={questions:config.empty?[]:questions};if(config.failQuiz){status=503;json={error:'fixture unavailable'};}}
  else if(p==='/api/learning/summary'){await config.summary?.wait;json=summary;if(config.failSummary){status=503;json={error:'unavailable'};}}
  else if(p==='/api/learning'){if(req.method()==='POST')json={success:true};else{await config.full?.wait;json=full;if(config.failSummary){status=503;json={error:'unavailable'};}}}
  else if(p==='/api/admin/status'){await config.admin?.wait;json={isAdmin:false};}
  else if(p==='/api/study-plan/home')json={owner:config.member?'alice':null,enabled:false,task:null};
  else if(p==='/api/stats/weekly-most-missed'){await config.weekly?.wait;json={source:null,min_attempts:10,question:null};}
  else if(p==='/api/stats/answers')json={success:true,recorded:false};
  else if(p==='/api/stats/option-distribution')json={sufficient:false,total:0,min_attempts:5,options:[]};
  else if(p==='/api/stats/difficulty')json={sufficient:false,total:0,min_attempts:10,rate:null};
  else {status=401;json={error:'isolated fixture'};}
  await r.fulfill({json,status}).catch(()=>{});
 });
 return {context,page,calls,close:async()=>{for(const v of Object.values(config))if(v?.release)v.release();await context.close();}};
}
const active=p=>p.locator('[data-brand-loading][data-active="true"]:visible');
async function ready(p){await active(p).waitFor({state:'hidden'});assert.equal(await p.locator('body > [inert]:not([data-brand-loading])').count(),0);}
async function screen(p,variant){await active(p).waitFor();assert.equal(await active(p).getAttribute('data-brand-loading'),variant);const rect=await active(p).boundingBox();assert.equal(rect.x,0);assert.equal(rect.y,0);assert.equal(rect.width,p.viewportSize().width);assert.equal(rect.height,p.viewportSize().height);assert.equal(await active(p).getByText('VetExam',{exact:true}).count(),1);assert.equal(await active(p).getByText('刷題，讓你更近夢想',{exact:true}).count(),1);assert.equal(await active(p).getByRole('progressbar').count(),0);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
async function capture(p,key,phase){await ready(p);await p.getByText('本週作答資料累積中',{exact:true}).waitFor();await p.evaluate(()=>document.fonts.ready);const b=await p.screenshot({path:out+'/'+phase+'-'+key+'.png',fullPage:true,animations:'disabled'});if(phase==='before')screens.set(key,b);else{const a=PNG.sync.read(screens.get(key)),c=PNG.sync.read(b);assert.equal(a.width,c.width);assert.equal(a.height,c.height);let changed=0,max=0;for(let i=0;i<a.data.length;i++){const d=Math.abs(a.data[i]-c.data[i]);if(d)changed++;max=Math.max(max,d);}assert(max<=1,`${key}: ${changed} channels delta ${max}`);visual.push({key,changed,max});}}
try{
 await mkdir(out,{recursive:true});browser=await chromium.launch({channel:'msedge',headless:true});
 for(const [phase,cwd] of [['before',resolve(process.env.LOADING_BASELINE_DIR)],['after',process.cwd()]]){
  console.log('VISUAL',phase);await start(cwd);for(const width of [375,1280]){const s=await setup({width});await s.page.goto(base);await capture(s.page,'home-'+width,phase);await s.close();}if(phase==='before')await stop();
 }
 // Streaming boundary is local to the homepage; no root loading.tsx inheritance.
 const homeHTML=await (await fetch(base)).text();assert.match(homeHTML,/data-brand-loading="home"/);assert.match(homeHTML,/今天也刷一點吧/);
 const login=await setup();await login.page.goto(base+'/login');assert.equal(await login.page.locator('[data-brand-loading]').count(),0);await login.close();
 // Session and availability are independent prerequisites. Slow auxiliary cards do not gate entry.
 for(const width of [320,375,1280]){
  const config={width,auth:gate(),availability:gate(),weekly:gate(),motion:'no-preference'},s=await setup(config);await s.page.goto(base);await screen(s.page,'home');
  const logo=await s.page.locator('.study-brand-icon svg path').getAttribute('d');assert.equal(await active(s.page).locator('svg path').getAttribute('d'),logo);
  await s.page.waitForFunction(()=>document.querySelector('.study-home')?.inert);assert(await s.page.getByRole('link',{name:'💬 回報問題',includeHidden:true}).evaluate(el=>el.inert));
  await s.page.screenshot({path:out+'/loading-home-'+width+'.png'});config.auth.release();await s.page.waitForTimeout(150);assert.equal(await active(s.page).count(),1);const released=Date.now();config.availability.release();await ready(s.page);assert(Date.now()-released<1000,'no minimum display timer');
  assert.equal(await s.page.locator('[data-brand-loading]').evaluate(el=>getComputedStyle(el).pointerEvents),'none');await s.page.getByRole('button',{name:'自訂首頁',exact:true}).click();assert.equal(await active(s.page).count(),0);await s.close();
 }
 // A slow session alone must still gate the fast settings response.
 const authGate=gate(),authOnly=await setup({auth:authGate});await authOnly.page.goto(base);await screen(authOnly.page,'home');await authOnly.page.waitForTimeout(150);assert.equal(await active(authOnly.page).count(),1);authGate.release();await ready(authOnly.page);await authOnly.close();
 for(const cached of [false,true]){const config={member:true,cached,summary:gate(),full:gate(),admin:gate()},s=await setup(config);await s.page.goto(base);if(!cached){await screen(s.page,'home');await s.page.waitForTimeout(150);assert.equal(await active(s.page).count(),1);config.summary.release();}await ready(s.page);assert.match(await s.page.locator('[aria-labelledby="home-status-title"]').innerText(),/3/);await s.close();}
 // Error/timeout outcomes release the gate to existing retry UI; retries are not a new full-screen visit.
 for(const mode of ['auth','availability','summary']){
  const config={failAuth:mode==='auth',failAvailability:mode==='availability',failSummary:mode==='summary',member:mode==='summary'},s=await setup(config);await s.page.goto(base);await ready(s.page);
  if(mode==='auth')await s.page.getByRole('button',{name:'重試',exact:true}).waitFor();
  if(mode==='summary')await s.page.getByText('學習紀錄暫時無法更新。',{exact:true}).waitFor();
  if(mode==='availability'){config.failAvailability=false;config.availability=gate();await s.page.getByRole('button',{name:'重新載入題數',exact:true}).click();await s.page.waitForTimeout(150);assert.equal(await active(s.page).count(),0);config.availability.release();}
  await s.close();
 }
 // Reduced-motion users get static dots and immediate hiding.
 const reducedGate=gate(),reduced=await setup({auth:reducedGate});await reduced.page.goto(base);await screen(reduced.page,'home');assert.equal(await active(reduced.page).locator('i').first().evaluate(el=>getComputedStyle(el).animationName),'none');reducedGate.release();await ready(reduced.page);assert.equal(await reduced.page.locator('[data-brand-loading]').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await reduced.close();
 // Hold navigation, then hold API: the same brand appears before either stage finishes.
 for(const mode of ['practice','exam']){
  const config={quiz:gate()},s=await setup(config),navGate=gate();await s.page.goto(base+'/subjects');assert.equal(await active(s.page).count(),0);await s.page.getByRole('button',{name:'選擇獸醫病理學，設定練習'}).click();await s.page.getByText('符合條件共有 8 題',{exact:true}).waitFor();const years=s.page.getByRole('group',{name:'考試年份（可多選）'});await years.locator('summary').click();await years.getByRole('button',{name:'民國 115 年',exact:true}).click();await years.getByRole('button',{name:'民國 114 年',exact:true}).click();if(mode==='exam')await s.page.getByRole('button',{name:/模擬考模式/}).click();const startLink=s.page.getByRole('link',{name:'開始刷題 →',exact:true}),href=await startLink.getAttribute('href');
  await s.page.route('**/questions?**',async r=>{await navGate.wait;await r.continue().catch(()=>{});});await startLink.click();await screen(s.page,'quiz');assert.equal(await s.page.getByRole('dialog').count(),0);navGate.release();await s.page.waitForURL('**/questions?**');await screen(s.page,'quiz');await s.page.screenshot({path:out+'/loading-quiz-'+mode+'.png'});config.quiz.release();await ready(s.page);assert.equal(new URL(s.page.url()).search,new URL(href,base).search);
  const query=s.calls.find(c=>c.path==='/api/quiz'&&!c.params.settings);assert.equal(query.params.mode,mode);assert.equal(query.params.order,'random');assert.deepEqual(JSON.parse(query.params.groups),[{subject,years:[2026,2025],count:'10'}]);assert.equal(query.params.scope,'public');
  const choices=s.page.getByRole('group',{name:'答案選項'}).getByRole('button'),nav=s.page.getByRole('group',{name:'題目導覽'});await choices.nth(1).click();await nav.getByRole('button',{name:'下一題',exact:true}).click();assert.equal(await active(s.page).count(),0);assert.equal(await s.page.getByRole('region',{name:'答案與解析'}).count(),0);await nav.getByRole('button',{name:'上一題',exact:true}).click();assert.equal(await choices.nth(1).getAttribute('aria-pressed'),'true');assert.equal(await active(s.page).count(),0);
  if(mode==='practice'){assert(await choices.nth(1).isDisabled());assert.equal(s.calls.filter(c=>c.path==='/api/stats/answers').length,1);}else assert.equal(s.calls.filter(c=>c.path==='/api/stats/answers').length,0);await s.close();
 }
 for(const config of [{failQuiz:true},{empty:true}]){const s=await setup(config);await s.page.goto(base+'/questions?started=1');await s.page.getByRole('heading',{name:config.empty?'目前沒有符合條件的題目':'無法取得題目',exact:true}).waitFor();await ready(s.page);await s.close();}
 // Leaving while an API is pending must release all inert background controls.
 const leaving=await setup({quiz:gate()});await leaving.page.goto(base+'/subjects');await leaving.page.goto(base+'/questions?started=1');await screen(leaving.page,'quiz');await leaving.page.goBack();await ready(leaving.page);await leaving.page.getByRole('button',{name:'選擇獸醫病理學，設定練習'}).click();await leaving.page.getByRole('dialog').waitFor();await leaving.close();
 assert.deepEqual(errors,[]);await writeFile(out+'/results.json',JSON.stringify({passed:true,visual},null,2));console.log('PASS home prerequisites/cache/error/retry, local SSR boundary, exact logo, RWD, motion preferences, nonblocking ready fade; quiz navigation/API loading, parameter preservation, no next/back spinner or duplicate score, error/empty/cancel cleanup; homepage visual regression');
}catch(e){await writeFile(out+'/server.log',log);console.error(errors);for(const c of browser?.contexts()??[])for(const p of c.pages()){console.error(p.url(),(await p.locator('body').innerText()).slice(0,1200));await p.screenshot({path:out+'/failure.png'});}throw e;}finally{await browser?.close();await stop();}
