import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.TEST_BASE_URL||'http://localhost:3280',phase=process.env.UI_PHASE||'after';
const out=`.tmp/home-experience/${phase}`;mkdirSync(out,{recursive:true});
const widths=[320,375,430,768,1024,1280,1440,1920];
const subjects=['獸醫病理學','獸醫藥理學','獸醫實驗診斷學','獸醫普通疾病學','獸醫傳染病學','獸醫公共衛生學'];
const oldOrder=['countdown','features','weekly-most-missed','progress','subjects','chapter-stats','daily-goal','achievement'];
const newOrder=['countdown','daily-goal','features','progress','achievement','subjects','chapter-stats','weekly-most-missed'];
const progress={[subjects[0]]:{answered:[1,2,3,4,5,6,7,8,9,10],correct:8,wrong:2}};
const question={id:901,questionSetId:1,questionNumber:1,subject:subjects[0],question:'有關獸醫病理學的敘述，何者正確？',options:['甲','乙','丙','丁'],answer:'A',explanation:'這是介面測試用解析。',examYear:2026,questionSetName:'UI fixture'};
const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[],requests={};
async function setup({role='guest',existing=false,saved=null,reduced=false,noObserver=false,fail=false}={}){
 const page=await browser.newPage({viewport:{width:375,height:900},reducedMotion:reduced?'reduce':'no-preference'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({progress,existing,saved,noObserver})=>{
  window.__homeMotionStats={instances:0,active:0,maxActive:0,starts:0};
  document.addEventListener('animationstart',event=>{if(/homeReveal|homeProgress/.test(event.animationName))window.__homeMotionStats.starts++});
  if(noObserver)delete window.IntersectionObserver;
  else {const Native=window.IntersectionObserver;window.IntersectionObserver=class extends Native {
   counted=false;motionActive=false;
   observe(target){if(target.hasAttribute('data-home-motion')){const stats=window.__homeMotionStats;if(!this.counted){stats.instances++;this.counted=true}if(!this.motionActive){stats.active++;stats.maxActive=Math.max(stats.maxActive,stats.active);this.motionActive=true}}super.observe(target)}
   disconnect(){if(this.motionActive){window.__homeMotionStats.active--;this.motionActive=false}super.disconnect()}
  }};
  if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.setItem('progress',JSON.stringify(existing?progress:{}));localStorage.setItem('dailyProgress',JSON.stringify({[new Date().toISOString().split('T')[0]]:{completed:existing?7:0}}));localStorage.setItem('examDate','2027-07-31');if(saved)localStorage.setItem('vetexam.home.layout.v1',JSON.stringify(saved));}
  for(const role of ['user','admin']){localStorage.setItem(`learningMigrated:${role}`,'1');localStorage.setItem('learningLegacyOwner',role)}
 },{progress,existing,saved,noObserver});
 await page.route('**/api/**',r=>{const url=new URL(r.request().url()),path=url.pathname;requests[path]=(requests[path]||0)+1;
  let json={};
  if(path==='/api/auth/get-session')json=role==='guest'?null:{user:{id:role,name:'測試帳號',email:'fixture@example.test'},session:{id:'fixture',userId:role}};
  else if(path==='/api/learning'){if(fail)return r.fulfill({status:503,json:{error:'fixture'}});json={owner:role,progress:existing?progress:{},history:existing?Array.from({length:7},(_,i)=>({question_id:i+1,subject:subjects[0],chapter:'腫瘤',is_correct:i<5,answered_at:new Date().toISOString(),mode:'practice'})):[],favorites:[],wrongQuestions:[],legacy:[]};}
  else if(path==='/api/admin/status')json={isAdmin:role==='admin'};
  else if(path==='/api/quiz')json=url.searchParams.has('settings')?{availability:subjects.map(subject=>({subject,year:2026,count:40})),chapterAvailability:[{subject:subjects[0],year:2026,chapter:'腫瘤',count:20}]}:{questions:[question]};
  else if(path==='/api/stats/weekly-most-missed')json={question:{question_id:901,question_number:1,exam_subject:subjects[0],question:question.question,wrong_attempts:12,total_attempts:20},min_attempts:10};
  else if(path==='/api/stats/option-distribution')json={total:0,sufficient:false,min_attempts:5,options:[]};
  return r.fulfill({json});
 });
 return page;
}
async function settleAll(page){await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,35))}window.scrollTo(0,0)});await page.waitForTimeout(500)}
try{
 for(const role of ['guest','user','admin'])for(const existing of [false,true]){
  const p=await setup({role,existing});await p.goto(base);await p.getByRole('button',{name:'挑戰這題',exact:false}).waitFor();await p.locator(role==='guest'?'.study-register':'.study-account-menu').waitFor();await p.waitForFunction(()=>!document.querySelector('.study-records [aria-busy="true"]'));
  if(existing)await p.getByRole('img',{name:'整體正確率 80%'}).waitFor();
  if(phase==='after'){
   const flow=p.getByRole('region',{name:'VetExam 怎麼陪你準備國考？'});await flow.waitFor();assert.equal(await flow.getByRole('list').getByRole('heading',{level:3}).count(),4);
   assert.deepEqual(await p.locator('[data-widget]').evaluateAll(els=>els.map(el=>el.dataset.widget)),newOrder);
   const hero=p.getByRole('region',{name:'今日學習狀態'});
   if(existing){await hero.getByRole('progressbar',{name:'今日學習完成百分比'}).waitFor();assert.equal(await hero.getByRole('progressbar').getAttribute('aria-valuenow'),'35');assert.match(await hero.innerText(),/7/)}
   else{assert.equal(await hero.getByRole('progressbar').count(),0);assert.match(await hero.innerText(),/你的第一步/)}
   assert.match(await flow.innerText(),/尚未作答或紀錄不足時/);
  }
  for(const width of widths){await p.setViewportSize({width,height:900});await settleAll(p);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${role}/${existing} overflow ${width}`);
   if(width<1200){const menu=p.locator('.study-mobile-nav summary');await menu.focus();await menu.press('Enter');const nav=p.getByRole('navigation',{name:'行動版導覽'});assert.equal(await nav.locator('a[href="/pdf"]').count(),role==='admin'?1:0);await menu.press('Enter')}
   else assert.equal(await p.locator('.study-desktop-nav a[href="/pdf"]').count(),role==='admin'?1:0);
   if(phase==='after'){const boxes=await p.locator('[data-home-step]').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y}}));if(width<768)assert(boxes.every((b,i)=>i===0||b.y>boxes[i-1].y),'flow must stack');if(width>=1024)assert(boxes.every(b=>Math.abs(b.y-boxes[0].y)<2),'desktop flow horizontal');}
   if(role==='guest'||role==='user'&&existing)await p.screenshot({path:`${out}/${role}-${existing?'existing':'new'}-${width}.png`,fullPage:true});
  }
  if(role==='guest'&&!existing){
   const before=Number((await p.locator('.study-days').innerText()).replace(/\D/g,''));await p.getByLabel('我的目標考試日期').fill('2027-08-01');assert.equal(Number((await p.locator('.study-days').innerText()).replace(/\D/g,'')),before+1);assert.equal(await p.evaluate(()=>localStorage.getItem('examDate')),'2027-08-01');
   await p.locator('.study-subject-filter summary').click();await p.getByPlaceholder('搜尋國考科目…').fill('病理');assert.equal(await p.locator('.study-bank').count(),1);await p.getByPlaceholder('搜尋國考科目…').fill('不存在');await p.getByText('沒有符合的科目，試試「病理」或「藥理」。').waitFor();await p.getByPlaceholder('搜尋國考科目…').fill('');assert.equal(await p.locator('.study-bank').count(),6);
   await p.getByRole('button',{name:'挑戰這題',exact:false}).click();await p.getByRole('group',{name:'本週魔王題答案選項'}).getByRole('button').first().click();await p.getByRole('region',{name:'答案與解析'}).waitFor();await p.keyboard.press('Escape');assert(await p.getByRole('button',{name:'挑戰這題',exact:false}).evaluate(el=>el===document.activeElement));
   assert.equal(await p.locator('a[href^="tel:"]').count(),0);assert.equal(await p.locator('a[href="https://www.instagram.com/vetexam.tw/"]').count(),1);
  }
  await p.close();
 }
 const saved={order:[...oldOrder].reverse(),hidden:['countdown','subjects']};const p=await setup({saved});await p.goto(base);await p.locator('.study-features').waitFor();await p.waitForTimeout(200);assert.deepEqual(await p.locator('[data-widget]').evaluateAll(els=>els.map(el=>el.dataset.widget)),saved.order.filter(id=>!saved.hidden.includes(id)));assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('vetexam.home.layout.v1'))),saved);
 await p.getByRole('button',{name:'自訂首頁',exact:true}).click();await p.getByRole('button',{name:'顯示「國考倒數」',exact:true}).click();await p.getByLabel('我的目標考試日期').waitFor();await p.getByRole('button',{name:'恢復預設版面',exact:true}).click();await p.getByRole('button',{name:'完成自訂',exact:true}).click();assert.deepEqual(await p.locator('[data-widget]').evaluateAll(els=>els.map(el=>el.dataset.widget)),phase==='after'?newOrder:oldOrder);
 await p.close();
 if(phase==='after'){
  for(const opts of [{reduced:true},{noObserver:true}]){const p=await setup({...opts,existing:true});await p.goto(base);await p.getByRole('region',{name:'今日學習狀態'}).getByRole('progressbar').waitFor();await settleAll(p);assert.equal(await p.locator('[data-home-motion="pending"]').count(),0);assert.equal(await p.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);await p.screenshot({path:`${out}/${opts.reduced?'reduced':'no-observer'}.png`,fullPage:true});await p.close();}
  const motion=await setup({existing:true});await motion.goto(base);await motion.getByRole('region',{name:'今日學習狀態'}).getByRole('progressbar').waitFor();await settleAll(motion);
  const counts=await motion.evaluate(()=>window.__homeMotionStats);assert.equal(counts.maxActive,1);assert(counts.starts>0,'reveal/progress should animate');await settleAll(motion);assert.equal(await motion.evaluate(()=>window.__homeMotionStats.starts),counts.starts,'scrolling again must not replay');assert.equal(await motion.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
  await motion.setViewportSize({width:1280,height:900});const feature=motion.locator('.study-feature').first();await feature.hover();await motion.waitForTimeout(220);assert.equal(await feature.evaluate(el=>getComputedStyle(el).transform),'matrix(1, 0, 0, 1, 0, -2)');await feature.focus();assert.equal(await feature.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
  await motion.emulateMedia({reducedMotion:'reduce'});await motion.waitForFunction(()=>!document.querySelector('[data-home-motion='+String.fromCharCode(34)+'pending'+String.fromCharCode(34)+']'));assert.equal(await motion.locator('[data-home-motion="pending"]').count(),0);assert.equal(await feature.evaluate(el=>getComputedStyle(el).transform),'none');assert.equal(await motion.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);writeFileSync(`${out}/motion.json`,JSON.stringify(counts,null,2));await motion.close();
  const noJS=await browser.newPage({javaScriptEnabled:false});await noJS.goto(base);await noJS.getByRole('heading',{name:'VetExam 怎麼陪你準備國考？'}).waitFor();assert.equal(await noJS.locator('[data-home-reveal]').evaluateAll(els=>els.every(el=>getComputedStyle(el).opacity==='1')),true);await noJS.close();
  const p=await setup({role:'user',fail:true});await p.goto(base);await p.getByRole('region',{name:'今日學習狀態'}).getByText('學習紀錄暫時無法更新。').waitFor();assert.equal(await p.getByRole('region',{name:'今日學習狀態'}).getByRole('progressbar').count(),0);await p.close();
 }
 assert.equal(requests['/api/review/due'],undefined);assert.equal(requests['/api/study-plan/daily'],undefined);assert.deepEqual(errors,[]);writeFileSync(`${out}/requests.json`,JSON.stringify(requests,null,2));console.log(`PASS ${phase}: six user states x eight widths, nav/admin, countdown, search, weekly, saved layout${phase==='after'?', new process/status, reduced motion, missing observer, sync error':''}`);
}finally{await browser.close()}
