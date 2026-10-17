// Real Next SSR and browser UI; all SQL is isolated PGlite. No production env.
import assert from 'node:assert/strict';
import {mkdir,cp,writeFile,symlink,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {fixture,loadCoach,taxonomy} from './helpers/coach-v2-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),f=await fixture();
const require=createRequire(import.meta.url),{PNG}=require(resolve(process.env.PLAYWRIGHT_MODULE,'../../playwright-core/lib/utilsBundle.js'));
const out=resolve('.tmp/home-coach-browser'),baseline=resolve(process.env.HOME_BASELINE||'.tmp/home-baseline'),after=resolve('.tmp/home-browser-app');
const base='http://127.0.0.1:3153',errors=[],metrics=[];
let browser,server,log='',bridge;
const mocks={'@/lib/auth':{auth:{api:{getSession:async({headers})=>headers.get('x-test-user')?{user:{id:headers.get('x-test-user')}}:null}}},'@/lib/question-transaction':{questionTransaction:f.transaction}};
const home=loadCoach('app/api/study-plan/home/route.ts',mocks);
const order=['daily-goal','due-review','countdown','subjects','progress','chapter-stats','weekly-most-missed','features','achievement'];
const saved={order:[...order].reverse(),hidden:['countdown','features']};
async function stop(){if(!server)return;const s=server;server=null;s.kill();await new Promise(r=>{if(s.exitCode!==null)return r();s.once('exit',r);setTimeout(r,4000);});}
async function start(cwd){log='';server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3153'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'postgresql://unused@127.0.0.1:1/never_connect',BETTER_AUTH_SECRET:'isolated-browser-secret-at-least-32-characters',BETTER_AUTH_URL:base}});server.stdout.on('data',c=>log=(log+c).slice(-30000));server.stderr.on('data',c=>log=(log+c).slice(-30000));
 for(let n=0;n<120;n++){try{if((await fetch(base+'/next.svg')).ok)return;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}throw Error(log);
}
async function pageFor(owner=null,width=375,layout=null,delay=0){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
 if(owner)await context.addCookies([{name:'better-auth.session_token',value:owner,url:base}]);
 page.on('pageerror',e=>errors.push(e.message));const calls=[];
 await page.addInitScript(({owner,layout})=>{if(owner){localStorage.setItem('learningLegacyOwner',owner);localStorage.setItem('learningMigrated:'+owner,'1');}if(layout)localStorage.setItem('vetexam.home.layout.v1',JSON.stringify(layout));},{owner,layout});
 await page.route('**/api/**',async r=>{const req=r.request(),path=new URL(req.url()).pathname;calls.push({path,method:req.method()});
  const handler=path==='/api/study-plan/home'?home:path==='/api/study-plan/daily'?f.route:path==='/api/study-plan/coach'?f.coachRoute:path==='/api/study-plan/diagnostic'?f.diagnosticRoute:null;
  if(handler){const response=await handler[req.method()](new Request(req.url(),{method:req.method(),headers:{...req.headers(),...(owner?{'x-test-user':owner}:{})},...(req.postData()?{body:req.postData()}:{})}));return r.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
  let json={};
  if(path==='/api/auth/sign-out'){owner=null;await context.clearCookies();json={success:true};}
  else if(path==='/api/auth/get-session'){if(delay)await new Promise(r=>setTimeout(r,delay));json=owner?{user:{id:owner,name:'Fixture',email:'fixture@example.test'},session:{id:'fixture',userId:owner}}:null;}
  else if(path==='/api/learning/summary')json={owner,progress:{},todayCompleted:0,todayDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date())};
  else if(path==='/api/learning')json={owner,progress:{},history:[],favorites:[],wrongQuestions:[],legacy:[]};
  else if(path==='/api/admin/status')json={isAdmin:false};
  else if(path==='/api/stats/weekly-most-missed')json={source:null,min_attempts:10,question:null};
  else if(path==='/api/quiz')json={availability:taxonomy.EXAM_SUBJECTS.map(subject=>({subject,year:115,count:20})),chapterAvailability:[]};
  else if(path==='/api/study-plan')json={mode:'coach'};
  await r.fulfill({json});
 });return {page,context,calls};
}
async function settle(page){await page.locator('.study-account').getByText(/Fixture|建立帳號/).waitFor();await page.getByText('本週作答資料累積中',{exact:true}).waitFor();await page.waitForTimeout(650);await page.addStyleTag({content:'nextjs-portal {display:none!important}'});await page.evaluate(()=>document.fonts.ready);}
async function geometry(page){return page.locator('[data-widget]').evaluateAll(els=>els.map(el=>({id:el.dataset.widget,rect:el.getBoundingClientRect().toJSON()})));}
function comparePixels(a,b){
 const first=PNG.sync.read(a),second=PNG.sync.read(b);assert.equal(first.width,second.width);assert.equal(first.height,second.height);
 let channels=0,maxDelta=0;for(let n=0;n<first.data.length;n++){const delta=Math.abs(first.data[n]-second.data[n]);if(delta)channels++;maxDelta=Math.max(maxDelta,delta);}
 // Chromium can round a few antialiased edge channels by 1/255 between runs.
 // All element geometry is exact; no changed color, text or layout is tolerated.
 assert(maxDelta<=1&&channels<300,`visual difference: ${channels} channels, max delta ${maxDelta}`);return {channels,maxDelta};
}
try{
 await mkdir(out,{recursive:true});assert(existsSync(resolve(baseline,'app/page.tsx')),'prepare baseline via git archive before running');
 // Copy source into a disposable Next app. Overrides below never touch app code.
 for(const name of ['app','components','lib','data','public','package.json','package-lock.json','tsconfig.json','next.config.ts','next-env.d.ts','postcss.config.mjs'])if(existsSync(name))await cp(name,resolve(after,name),{recursive:true});
 const modules=await realpath('node_modules');for(const dir of [baseline,after])if(!existsSync(resolve(dir,'node_modules')))await symlink(modules,resolve(dir,'node_modules'),'junction');
 bridge=createServer(async(req,res)=>{try{let body='';for await(const c of req)body+=c;const {text,values}=JSON.parse(body);assert(/^(SELECT|WITH)\s/.test(text.trim()),'SSR bridge is strictly read-only');const value=await f.db.query(text,values);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}});await new Promise(r=>bridge.listen(0,'127.0.0.1',r));
 const bridgeUrl='http://127.0.0.1:'+bridge.address().port;
 await writeFile(resolve(after,'lib/auth.ts'),`export const auth={api:{getSession:async({headers}:{headers:Headers})=>{const id=headers.get('cookie')?.match(/better-auth.session_token=([abc])/ )?.[1];return id?{user:{id}}:null;}}};`);
 await writeFile(resolve(after,'lib/question-transaction.ts'),`import type {PoolClient} from 'pg';export async function questionTransaction<T>(run:(client:PoolClient)=>Promise<T>){return run({query:async(text:string,values:unknown[])=>{const response=await fetch('${bridgeUrl}',{method:'POST',body:JSON.stringify({text,values}),cache:'no-store'});if(!response.ok)throw Error('fixture query failed');return response.json();}} as unknown as PoolClient);}`);
 await f.query("UPDATE study_plans SET mode='custom' WHERE user_id='b'");await f.query("DELETE FROM study_plans WHERE user_id='c'");await f.seed('a');await f.ensure('a');
 browser=await chromium.launch({channel:'msedge',headless:true});const before=new Map();
 for(const [phase,dir] of [['before',baseline],['after',after]]){
  await start(dir);
  for(const owner of [null,'b','c'])for(const width of [375,1280])for(const layout of [null,saved]){
   const {page,context,calls}=await pageFor(owner,width,layout);await page.goto(base);await settle(page);assert.equal(await page.locator('[data-home-coach]').count(),0);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const geo=await geometry(page),key=`${owner??'guest'}-${width}-${layout?'custom':'default'}`,png=await page.screenshot({path:resolve(out,phase+'-'+key+'.png'),fullPage:true,animations:'disabled'});
   assert.deepEqual(geo.map(g=>g.id),layout?saved.order.filter(id=>!saved.hidden.includes(id)):order);
   let pixels=null;if(phase==='before')before.set(key,{geo,png});else{assert.deepEqual(geo,before.get(key).geo,'exact original geometry '+key);pixels=comparePixels(png,before.get(key).png);}
   if(!owner)assert(!calls.some(c=>c.path==='/api/study-plan/home'),'guest no coach requests');
   metrics.push({phase,key,pixels});await context.close();
  }
  if(phase==='before')await stop();
 }
 // Prove card is in SSR HTML, before session hydration; it never gets appended.
 const html=await (await fetch(base,{headers:{cookie:'better-auth.session_token=a'}})).text();assert(html.indexOf('id="home-coach-title"')>0);assert(html.indexOf('id="home-coach-title"')<html.indexOf('id="home-status-title"'));
 const {page,context}=await pageFor('a',375,null,1200);await page.goto(base,{waitUntil:'domcontentloaded'});const card=page.locator('[data-home-coach]');await card.waitFor();
 const gap=()=>page.evaluate(()=>document.querySelector('[data-home-coach]').getBoundingClientRect().y-document.querySelector('.study-welcome').getBoundingClientRect().bottom);
 const preGap=await gap();await settle(page);const post=await card.boundingBox();assert.equal(await gap(),preGap,'auth hydration never inserts a card or changes spacing after the original hero');assert(post.y<750,'mobile coach starts near top');
 assert.match(await card.innerText(),/已完成 0 題 · 尚未完成 20 題/);assert.equal(await card.getByRole('link',{name:'繼續練習',exact:true}).getAttribute('href'),'/study-plan/daily?task=weakness');
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(out,'coach-'+width+'.png'),fullPage:true});assert.deepEqual((await geometry(page)).map(g=>g.id),order);}
 await page.setViewportSize({width:375,height:900});await card.getByRole('link',{name:'繼續練習',exact:true}).click();await page.getByRole('group',{name:'每日任務答案選項'}).getByRole('button').first().click();await page.getByRole('button',{name:/^送出並/}).click();await page.getByText('今日已儲存 1 / 20 題',{exact:true}).waitFor();
 await page.goto(base);await card.getByText('已完成 1 題 · 尚未完成 19 題',{exact:true}).waitFor();await page.reload();await card.getByText('已完成 1 題 · 尚未完成 19 題',{exact:true}).waitFor();await card.getByRole('link',{name:'繼續練習',exact:true}).click();await page.getByText('今日已儲存 1 / 20 題',{exact:true}).waitFor();
 const second=await pageFor('a');await second.page.goto(base);await second.page.locator('[data-home-coach]').getByText('已完成 1 題 · 尚未完成 19 題',{exact:true}).waitFor();
 await second.page.locator('.study-account-menu summary').click();await second.page.getByRole('button',{name:'登出',exact:true}).click();await second.page.locator('.study-register').waitFor();assert.equal(await second.page.locator('[data-home-coach]').count(),0);await second.page.reload();assert.equal(await second.page.locator('[data-home-coach]').count(),0);await second.context.close();
 await page.goto(base);await card.waitFor();await f.query("UPDATE study_plans SET mode='custom' WHERE user_id='a'");await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await card.waitFor({state:'detached'});assert.deepEqual((await geometry(page)).map(g=>g.id),order);await context.close();
 // Fresh coach without evidence gets a real diagnostic link, no fake weakness.
 await f.query("INSERT INTO study_plans(user_id,mode) VALUES('c','coach')");const fresh=await pageFor('c');await fresh.page.goto(base);await fresh.page.getByRole('link',{name:'開始或繼續診斷',exact:true}).waitFor();await fresh.page.getByRole('link',{name:'開始或繼續診斷',exact:true}).click();await fresh.page.getByRole('button',{name:'開始診斷',exact:true}).waitFor();await fresh.context.close();
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'results.json'),JSON.stringify(metrics,null,2));
 console.log('PASS 12 visual before/after comparisons (guest/custom/no-plan × desktop/mobile × default/saved layout), exact geometry and only 1/255 raster tolerance; SSR before auth; real task start/resume/two devices; stop coach; diagnostic; no horizontal overflow');
}catch(e){await writeFile(resolve(out,'server.log'),log);throw e;}finally{await browser?.close();await stop();await new Promise(r=>bridge?bridge.close(r):r());await f.close();}
