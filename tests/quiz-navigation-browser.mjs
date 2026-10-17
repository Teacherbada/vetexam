// Actual Next UI with isolated HTTP fixtures; never loads production credentials.
// Prepare .tmp/baseline from the comparison commit, with the same dependencies.
// Build both copies with an unused local DATABASE_URL and test auth settings.
// Set PLAYWRIGHT_MODULE to Playwright's entry point and TEST_PRODUCTION=1, then
// run this file. Both Next servers and all browser contexts are closed on exit.
import assert from 'node:assert/strict';
import {mkdir,writeFile,symlink,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),require=createRequire(import.meta.url);
const {PNG}=require(resolve(process.env.PLAYWRIGHT_MODULE,'../../playwright-core/lib/utilsBundle.js'));
const base='http://127.0.0.1:3156',out=resolve('.tmp/quiz-navigation-browser'),baseline=resolve('.tmp/baseline');
const subject='獸醫病理學',image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="450"><rect width="900" height="450" fill="#eaf5ee"/><text x="90" y="200" font-size="60">IMAGE QUESTION 1</text></svg>');
const common={questionSetId:1,subject,examYear:2026,questionSetName:'Isolated fixture'};
const questions=[
 {...common,id:901,questionNumber:1,question:'第一題：長題幹與圖片，官方接受 A、B 任一答案。\n'+('請依題目資訊選出答案，這段文字只供介面換行與捲動測試。'.repeat(20)),options:['選項甲','選項乙','選項丙','選項丁','第五個選項，長內容。'.repeat(12)],answer:'["A","B"]',explanation:'### 第一題解析\n\n**中文與英文 terminology**\n\n'+('長篇解析測試。\n\n'.repeat(30)),imageDataUrl:image},
 {...common,id:902,questionNumber:2,question:'第二題：三個選項，沒有圖片。',options:['甲','乙','丙'],answer:'C',explanation:'### 第二題解析\n\n第三個選項正確。'},
 {...common,id:903,questionNumber:3,question:'第三題：四個選項，最後一題。',options:['甲','乙','丙','丁'],answer:'D',explanation:'### 第三題解析\n\n最後一題解析。\n\n'+('保留長篇內容。\n\n'.repeat(30))},
];
let server,browser,log='';const errors=[],screens=new Map(),results=[];
async function start(cwd){log='';const mode=process.env.TEST_PRODUCTION==='1'?['start']:['dev','--webpack'];server=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),...mode,'--hostname','127.0.0.1','--port','3156'],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'postgresql://unused@127.0.0.1:1/never_connect',BETTER_AUTH_SECRET:'isolated-browser-secret-at-least-32-characters',BETTER_AUTH_URL:base}});server.stdout.on('data',c=>log=(log+c).slice(-20000));server.stderr.on('data',c=>log=(log+c).slice(-20000));
 for(let n=0;n<120;n++){try{if((await fetch(base+'/next.svg')).ok)return;}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}throw Error(log);}
async function stop(){if(!server)return;const s=server;server=null;s.kill();await new Promise(r=>{if(s.exitCode!==null)return r();s.once('exit',r);setTimeout(r,4000);});}
async function setup(width=375,years=[2026,2025]){
 const context=await browser.newContext({viewport:{width,height:812},reducedMotion:'reduce'}),page=await context.newPage(),posts=[],queries=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async r=>{const req=r.request(),u=new URL(req.url()),p=u.pathname;let json={};
  if(p.startsWith('/api/auth/'))json=null;
  else if(p==='/api/admin/status')json={isAdmin:false};
  else if(p==='/api/quiz'){
   if(u.searchParams.has('settings'))json={availability:[...years.map(year=>({subject,year,count:4})),{subject,year:null,count:2},{subject:'獸醫藥理學',year:2020,count:3}],chapterAvailability:[{subject,year:years[0],chapter:'腫瘤',count:2}]};
   else {queries.push(Object.fromEntries(u.searchParams));json={questions};}
  }else if(p==='/api/stats/answers'){posts.push(req.postDataJSON());json={success:true,recorded:false};}
  else if(p==='/api/stats/option-distribution')json={sufficient:false,min_attempts:5,total:0,options:[]};
  else if(p==='/api/stats/difficulty')json={total:0,sufficient:false,min_attempts:10,rate:null};
  else if(p==='/api/stats/weekly-most-missed')json={source:null,min_attempts:10,question:null};
  else return r.fulfill({status:401,json:{error:'isolated fixture'}});
  return r.fulfill({json});
 });return {page,context,posts,queries};
}
const url=mode=>base+'/questions?started=1&order=original&mode='+mode;
const choices=p=>p.getByRole('group',{name:'答案選項'}).getByRole('button');
const nav=p=>p.getByRole('group',{name:'題目導覽',includeHidden:true});
async function settled(page){await page.locator('.study-register').waitFor();await page.getByText('本週作答資料累積中',{exact:true}).waitFor();await page.waitForTimeout(450);await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.evaluate(()=>document.fonts.ready);}
async function screenshot(page,key,phase){await page.addStyleTag({content:'nextjs-portal{display:none!important}'});await page.evaluate(()=>window.scrollTo(0,0));const png=await page.screenshot({path:resolve(out,phase+'-'+key+'.png'),fullPage:true,animations:'disabled'});
 if(phase==='before')screens.set(key,png);else{const a=PNG.sync.read(screens.get(key)),b=PNG.sync.read(png);assert.equal(a.width,b.width,key);assert.equal(a.height,b.height,key);let changed=0,max=0;for(let n=0;n<a.data.length;n++){const d=Math.abs(a.data[n]-b.data[n]);if(d)changed++;max=Math.max(max,d);}assert(max<=1,`${key}: ${changed} color channels, delta ${max}`);results.push({key,changed,max});}}
async function atHeading(page){const heading=page.getByRole('heading',{level:1});await page.waitForFunction(()=>document.activeElement?.tagName==='H1');const r=await heading.boundingBox(),scroll=await page.evaluate(()=>({y:scrollY,max:document.documentElement.scrollHeight-innerHeight}));assert(r.y>=0&&r.y<400,JSON.stringify(r));assert(r.y<=24||scroll.y>=scroll.max-2,'short pages stop at their available scroll limit');assert(await heading.evaluate(el=>el===document.activeElement));}
async function controls(page){const bar=await nav(page).boundingBox(),height=page.viewportSize().height;assert(bar.y>=0&&bar.y+bar.height<=height+1);assert.equal(await nav(page).count(),1);for(const b of await nav(page).getByRole('button').all()){const r=await b.boundingBox();assert(r.height>=44&&r.width>=44);assert(r.y>=bar.y&&r.y+r.height<=bar.y+bar.height);}assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
async function unoccluded(page,locator){await locator.scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollBy(0,180));const a=await locator.boundingBox(),b=await nav(page).boundingBox();assert(a.y+a.height<=b.y+1,`content overlaps bar: ${JSON.stringify({a,b})}`);}
try{
 await mkdir(out,{recursive:true});if(!existsSync(resolve(baseline,'node_modules')))await symlink(await realpath('node_modules'),resolve(baseline,'node_modules'),'junction');
 browser=await chromium.launch({channel:'msedge',headless:true});
 for(const [phase,cwd] of [['before',baseline],['after',process.cwd()]]){
  await start(cwd);
  for(const width of [375,1280]){const {page,context}=await setup(width);await page.goto(base);await settled(page);await screenshot(page,'home-'+width,phase);await context.close();}
  const {page,context}=await setup(1280);await page.goto(url('practice'));await choices(page).first().waitFor();await page.waitForTimeout(300);await screenshot(page,'desktop-quiz-unanswered',phase);await choices(page).nth(1).click();await page.getByRole('region',{name:'答案與解析'}).waitFor();await page.waitForTimeout(300);await screenshot(page,'desktop-quiz-answered',phase);if(phase==='after'){assert.equal(await page.getByRole('button',{name:'上一題',exact:true}).count(),0);assert.equal(await nav(page).evaluate(el=>getComputedStyle(el).position),'static');}await context.close();
  if(phase==='before')await stop();
 }
 // Small/large lists, keyboard disclosure, raw API year values and counts.
 for(const width of [320,375,1280])for(const years of [[2026,2025],Array.from({length:26},(_,i)=>2026-i)]){
  const {page,context,queries}=await setup(width,years);await page.goto(base+'/subjects');await page.getByRole('button',{name:'選擇獸醫病理學，設定練習'}).click();await page.getByText(`符合條件共有 ${years.length*4+2} 題`,{exact:true}).waitFor();
  const picker=page.getByRole('group',{name:'考試年份（可多選）'}),summary=picker.locator('summary');assert.equal(await picker.getByRole('button',{name:'全部年份',exact:true}).count(),0);await summary.focus();await summary.press('Enter');
  await picker.getByRole('button',{name:'民國 115 年',exact:true}).click();assert.match(await summary.innerText(),/民國 115 年/);await page.getByText('符合條件共有 4 題',{exact:true}).waitFor();let link=new URL(await page.getByRole('link',{name:'開始刷題 →',exact:true}).getAttribute('href'),base);assert.deepEqual(JSON.parse(link.searchParams.get('groups'))[0].years,[2026]);
  const last=years.at(-1);await picker.getByRole('button',{name:`民國 ${last-1911} 年`,exact:true}).click();await page.getByText('符合條件共有 8 題',{exact:true}).waitFor();await summary.click();await summary.click();assert.equal(await picker.getByRole('button',{name:'民國 115 年',exact:true}).getAttribute('aria-pressed'),'true');
  const list=picker.locator('[aria-label="可選考試年份"]');assert((await list.boundingBox()).height<=281);if(years.length>10)assert(await list.evaluate(el=>el.scrollHeight>el.clientHeight));
  await page.screenshot({path:resolve(out,`years-${width}-${years.length}.png`)});assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await picker.getByRole('button',{name:'全部年份',exact:true}).click();assert.equal(await picker.getByRole('button',{name:'全部年份',exact:true}).getAttribute('aria-pressed'),'true');
  await picker.getByRole('button',{name:'民國 115 年',exact:true}).click();await picker.getByRole('button',{name:'民國 115 年',exact:true}).click();assert.equal(await picker.getByRole('button',{name:'全部年份',exact:true}).getAttribute('aria-pressed'),'true','last deselection retains all-year semantics');
  await picker.getByRole('button',{name:'民國 115 年',exact:true}).click();await picker.getByRole('button',{name:`民國 ${last-1911} 年`,exact:true}).click();await page.getByRole('link',{name:'開始刷題 →',exact:true}).click();await choices(page).first().waitFor();assert.deepEqual(JSON.parse(queries.at(-1).groups),[{subject,years:[2026,last],count:'10'}]);assert.equal(queries.at(-1).scope,'public');await context.close();
 }
 // Legacy ROC-valued availability, one year and the existing chapter filter.
 const single=await setup(375,[115,110]);await single.page.goto(base+'/subjects');await single.page.getByRole('button',{name:'選擇獸醫病理學，設定練習'}).click();await single.page.getByText('符合條件共有 10 題',{exact:true}).waitFor();const yearField=single.page.getByRole('group',{name:'考試年份（可多選）'});await yearField.locator('summary').click();await yearField.getByRole('button',{name:'民國 115 年',exact:true}).click();await single.page.locator('summary').filter({hasText:/^章節：/}).click();await single.page.getByRole('button',{name:'腫瘤',exact:true}).click();await single.page.getByText('符合條件共有 2 題',{exact:true}).waitFor();await single.page.getByRole('link',{name:'開始刷題 →',exact:true}).click();await choices(single.page).first().waitFor();assert.deepEqual(JSON.parse(single.queries.at(-1).groups),[{subject,years:[115],count:'10',chapter:'腫瘤'}]);await single.context.close();
 // Practice: multiple accepted answers remain single-choice; back never records twice.
 for(const width of [320,375]){
  const {page,context,posts}=await setup(width);await page.goto(url('practice'));await choices(page).first().waitFor();await controls(page);assert(await nav(page).getByRole('button',{name:'上一題',exact:true}).isDisabled());assert(await nav(page).getByRole('button',{name:'下一題',exact:true}).isDisabled());
  await page.getByRole('button',{name:'放大查看：第 1 題圖片',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'關閉圖片 ×',exact:true}).click();
  await choices(page).nth(1).click();await page.getByText('✓ 答對了，正確答案：A、B',{exact:true}).waitFor();assert.equal(await choices(page).count(),5);assert.equal(await choices(page).getByText('✓ 正確答案',{exact:true}).count(),2);await unoccluded(page,choices(page).last());await unoccluded(page,page.getByRole('button',{name:'收藏題目',exact:true}));
  await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await controls(page);await unoccluded(page,page.getByRole('link',{name:'💬 回報問題',exact:true}));await page.screenshot({path:resolve(out,'practice-footer-'+width+'.png')});
  await nav(page).getByRole('button',{name:'下一題',exact:true}).click();await page.getByRole('heading',{name:questions[1].question,exact:true}).waitFor();await atHeading(page);assert.equal(await page.getByRole('region',{name:'答案與解析'}).count(),0);assert.equal(await page.getByRole('button',{name:'放大查看：第 1 題圖片',exact:true}).count(),0);assert.equal(await choices(page).count(),3);
  // Safe-area/text-size height changes must remeasure after a keyed question switch.
  await nav(page).evaluate(el=>el.style.paddingBottom='46px');await page.waitForFunction(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vetexam-quiz-actions-height'))===document.querySelector('[aria-label="題目導覽"]').getBoundingClientRect().height);const measured=await page.evaluate(()=>parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vetexam-quiz-actions-height')));assert.equal(measured,(await nav(page).boundingBox()).height);await controls(page);
  // Simulated overlay keyboard; real iOS/Android hardware remains a manual check.
  await page.evaluate(()=>{const input=document.createElement('textarea');input.id='test-keyboard';document.querySelector('main').append(input);input.focus();Object.defineProperty(visualViewport,'height',{configurable:true,value:innerHeight-280});visualViewport.dispatchEvent(new Event('resize'));});await page.waitForTimeout(100);assert.equal(await nav(page).evaluate(el=>getComputedStyle(el).visibility),'hidden');
  await page.evaluate(()=>{document.getElementById('test-keyboard').remove();delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});await page.waitForTimeout(100);assert.equal(await nav(page).evaluate(el=>getComputedStyle(el).visibility),'visible');
  await nav(page).getByRole('button',{name:'上一題',exact:true}).click();await atHeading(page);assert.equal(await choices(page).nth(1).getAttribute('aria-pressed'),'true');assert(await choices(page).nth(1).isDisabled());assert.equal(posts.length,1);
  await nav(page).getByRole('button',{name:'下一題',exact:true}).click();await choices(page).first().click();await page.getByText('✗ 答錯了，答案是 C',{exact:true}).waitFor();await nav(page).getByRole('button',{name:'下一題',exact:true}).click();assert(await nav(page).getByRole('button',{name:'完成測驗',exact:true}).isDisabled());
  await nav(page).getByRole('button',{name:'上一題',exact:true}).click();assert.match(await page.getByRole('region',{name:'答案與解析'}).innerText(),/第二題解析/);assert.equal(posts.length,2);await nav(page).getByRole('button',{name:'下一題',exact:true}).click();await choices(page).nth(3).click();await nav(page).getByRole('button',{name:'完成測驗',exact:true}).click();await page.getByRole('heading',{name:'完成這次測驗了',exact:true}).waitFor();await atHeading(page);assert.equal(await nav(page).count(),0);assert.equal(posts.length,3);assert.match(await page.locator('main').innerText(),/2 \/ 3/);assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--vetexam-quiz-actions-height')),'');
  await context.close();
 }
 // Exam navigation can skip; edits do not reveal answers or post until submission.
 for(const width of [375,1280]){const {page,context,posts}=await setup(width);await page.goto(url('exam'));await choices(page).nth(1).click();await nav(page).getByRole('button',{name:'下一題',exact:true}).click();await nav(page).getByRole('button',{name:'上一題',exact:true}).click();assert.equal(await choices(page).nth(1).getAttribute('aria-pressed'),'true');assert.equal(await page.getByRole('region',{name:'答案與解析'}).count(),0);await choices(page).first().click();assert.equal(posts.length,0);await nav(page).getByRole('button',{name:'下一題',exact:true}).click();await nav(page).getByRole('button',{name:'下一題',exact:true}).click();assert.equal(await nav(page).getByRole('button',{name:'下一題',exact:true}).count(),0);if(width<600)await controls(page);await nav(page).getByRole('button',{name:'交卷',exact:true}).click();await page.getByRole('heading',{name:'完成這次測驗了',exact:true}).waitFor();assert.equal(posts.length,1);assert.deepEqual(posts[0].answers,[{question_id:901,selected_answer:'A'}]);assert.match(await page.locator('main').innerText(),/未作答 2 題/);await context.close();}
 const auto=await setup();await auto.page.goto(url('exam'));for(const [index,answer] of [[0,0],[1,2],[2,3]]){await choices(auto.page).nth(answer).click();if(index<2)await nav(auto.page).getByRole('button',{name:'下一題',exact:true}).click();}await auto.page.getByRole('heading',{name:'完成這次測驗了',exact:true}).waitFor();assert.equal(auto.posts.length,1);assert.equal(auto.posts[0].answers.length,3);await auto.context.close();
 const reload=await setup();await reload.page.goto(url('practice'));await choices(reload.page).nth(1).click();await nav(reload.page).getByRole('button',{name:'下一題',exact:true}).click();const stored=await reload.page.evaluate(()=>localStorage.getItem('progress'));await reload.page.reload();await choices(reload.page).first().waitFor();assert.equal(await reload.page.getByRole('group',{name:'答案選項'}).locator('button[aria-pressed="true"]').count(),0);assert.equal(await reload.page.getByRole('region',{name:'答案與解析'}).count(),0);assert(await nav(reload.page).getByRole('button',{name:'上一題',exact:true}).isDisabled());assert.equal(reload.posts.length,1);assert.equal(await reload.page.evaluate(()=>localStorage.getItem('progress')),stored);await reload.context.close();
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'results.json'),JSON.stringify({visual:results,passed:true},null,2));console.log('PASS homepage/desktop quiz visual regression; small/26-year lists, multi-year raw filters, all/deselect; fixed controls 320/375; long stem/image/3–5 options/multiple accepted answers; prior state/no double scoring; scroll/focus; safe-area reservation/keyboard simulation; exam submit/auto-submit; reload preserves original history semantics');
}catch(e){await writeFile(resolve(out,'server.log'),log);console.error('Browser errors:',errors);for(const context of browser?.contexts()??[])for(const page of context.pages()){console.error('Failed page:',page.url(),(await page.locator('body').innerText()).slice(0,2000));await page.screenshot({path:resolve(out,'failure.png')});}throw e;}finally{await browser?.close();await stop();}
