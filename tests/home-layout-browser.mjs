import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.TEST_BASE_URL || 'http://localhost:3295';
const phase = process.env.UI_PHASE || 'after';
const out = `.tmp/home-layout/${phase}`; mkdirSync(out, { recursive: true });
const widths = [320,375,430,768,1024,1280,1440,1920];
const order = ['countdown','daily-goal','progress','features','subjects','chapter-stats','weekly-most-missed','achievement'];
const labels = ['國考倒數','今日目標','我的學習進度','VetExam 功能介紹','選擇題庫開始練習','各章節歷屆題量','本週最多人答錯','學習小成就'];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], evidence = [];
async function setup(saved = null, source = 'random_fallback') {
 const page = await browser.newPage({viewport:{width:375,height:900}});
 page.on('pageerror', error => errors.push(error.message));
 await page.addInitScript(saved => {
  if (!sessionStorage.getItem('seeded')) {
   sessionStorage.setItem('seeded','1');
   localStorage.setItem('progress',JSON.stringify({'獸醫病理學':{answered:[1,2,3,4,5],correct:4,wrong:1}}));
   localStorage.setItem('dailyProgress',JSON.stringify({[new Date().toISOString().split('T')[0]]:{completed:5}}));
   if(saved !== null)localStorage.setItem('vetexam.home.layout.v1',typeof saved === 'string'?saved:JSON.stringify(saved));
  }
 }, saved);
 await page.route('**/api/**',r=>{
  const path=new URL(r.request().url()).pathname; let json={};
  if(path==='/api/auth/get-session')json=null;
  else if(path==='/api/quiz')json={availability:['獸醫病理學','獸醫藥理學','獸醫實驗診斷學','獸醫普通疾病學','獸醫傳染病學','獸醫公共衛生學'].map(subject=>({subject,year:115,count:40})),chapterAvailability:[{subject:'獸醫病理學',year:115,chapter:'腫瘤',count:20}]};
  else if(path==='/api/stats/weekly-most-missed')json={source,min_attempts:10,question:{question_id:1,question_number:12,exam_subject:'獸醫病理學',question:'關於細胞損傷與組織修復，下列敘述何者正確？',...(source==='weekly'?{wrong_attempts:12,total_attempts:20}:{})}};
  return r.fulfill({json});
 });
 await page.goto(base);await page.locator('.study-register').waitFor();
 if(!saved?.hidden?.includes('progress'))await page.getByRole('img',{name:'整體正確率 80%'}).waitFor();
 if(!saved?.hidden?.includes('weekly-most-missed'))await page.getByRole('button',{name:'挑戰這題',exact:false}).waitFor();
 return page;
}
async function settle(page) {
 await page.evaluate(async()=>{for(let y=0;y<document.documentElement.scrollHeight;y+=550){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,40));}window.scrollTo(0,0);});await page.waitForTimeout(450);
}
const widgetOrder = page => page.locator('[data-widget]').evaluateAll(els=>els.map(el=>el.dataset.widget));
async function geometry(page,width,editing) {
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);
 const data=await page.locator('[data-widget]').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect(),toolbar=el.querySelector('.study-widget-controls'),content=el.querySelector('.study-widget-content');return{id:el.dataset.widget,x:r.x,y:r.y,w:r.width,h:r.height,toolbar:toolbar?.getBoundingClientRect().toJSON(),content:content?.getBoundingClientRect().toJSON(),span:el.dataset.span};}));
 for(const row of data)if(editing){assert(row.toolbar.bottom<=row.content.y+1,`${width}/${row.id}: toolbar overlaps content`);}
 if(width<1024)for(let i=1;i<data.length;i++)assert(data[i].y>=data[i-1].y+data[i-1].h-1,`${width}: widgets must stack`);
 const full=['features','subjects','chapter-stats','weekly-most-missed'];for(const row of data.filter(x=>full.includes(x.id)))assert.equal(row.span,'full');
 const controls=await page.locator('.study-widget-controls button').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return{w:r.width,h:r.height,label:el.getAttribute('aria-label')}}));
 for(const c of controls){assert(c.w>=44&&c.h>=44,`${width}: small target`);assert(c.label);}
 assert.equal(await page.locator('.study-welcome [data-widget], [aria-labelledby="home-journey-title"] [data-widget]').count(),0);
 evidence.push({width,editing,widgets:data.length,controls:controls.length});
}
try {
 const page=await setup();
 for(const width of phase==='before'?[375,1440]:widths){await page.setViewportSize({width,height:1000});await settle(page);
  if(phase==='after'){assert.deepEqual(await widgetOrder(page),order);assert.equal(await page.locator('.study-widget-controls').count(),0);await geometry(page,width,false);}
  if([375,1440].includes(width)){await page.screenshot({path:`${out}/default-${width}.png`,fullPage:true});await page.locator('.study-welcome').screenshot({path:`${out}/hero-${width}.png`});await page.locator('.study-weekly').screenshot({path:`${out}/weekly-${width}.png`});}
  await page.getByRole('button',{name:'自訂首頁',exact:true}).click();await settle(page);
  if(phase==='after'){await page.getByRole('heading',{name:'正在自訂首頁'}).waitFor();await geometry(page,width,true);assert.equal(await page.locator('.study-widget-controls').count(),8);assert.equal(await page.getByRole('button',{name:`上移「${labels[0]}」`,exact:true}).isDisabled(),true);}
  if([375,1440].includes(width)){await page.screenshot({path:`${out}/editing-${width}.png`,fullPage:true});if(phase==='after')await page.locator('[data-widget="daily-goal"]').screenshot({path:`${out}/toolbar-${width}.png`});}
  await page.getByRole('button',{name:'完成自訂',exact:true}).click();
 }
 if(phase==='after'){
  await page.setViewportSize({width:375,height:900});await page.getByRole('button',{name:'自訂首頁',exact:true}).click();
  const down=page.getByRole('button',{name:'下移「國考倒數」',exact:true});await down.focus();await down.press('Enter');assert.deepEqual((await widgetOrder(page)).slice(0,2),['daily-goal','countdown']);assert(await down.evaluate(el=>el===document.activeElement));assert.notEqual(await down.evaluate(el=>getComputedStyle(el).outlineStyle),'none');
  await page.reload();await page.getByRole('img',{name:'整體正確率 80%'}).waitFor();assert.deepEqual((await widgetOrder(page)).slice(0,2),['daily-goal','countdown']);assert.equal(await page.locator('.study-widget-controls').count(),0);
  await page.getByRole('button',{name:'自訂首頁',exact:true}).click();await page.getByRole('button',{name:'隱藏「國考倒數」',exact:true}).click();assert.equal(await page.locator('[data-widget="countdown"]').count(),0);assert.equal(await page.locator('.study-layout-notice').evaluate(el=>getComputedStyle(el).position),'static');await page.getByRole('button',{name:'復原',exact:true}).click();await page.locator('[data-widget="countdown"]').waitFor();
  await page.getByRole('button',{name:'隱藏「國考倒數」',exact:true}).click();await page.reload();await page.getByRole('button',{name:'自訂首頁',exact:true}).click();await page.getByRole('button',{name:'顯示「國考倒數」'}).click();await page.locator('[data-widget="countdown"]').waitFor();
  const source=page.locator('[data-widget="achievement"] [draggable]'),target=page.locator('[data-widget="features"]');const dt=await page.evaluateHandle(()=>new DataTransfer());await source.dispatchEvent('dragstart',{dataTransfer:dt});await target.dispatchEvent('dragover',{dataTransfer:dt});await target.dispatchEvent('drop',{dataTransfer:dt});assert((await widgetOrder(page)).indexOf('achievement')<(await widgetOrder(page)).indexOf('features'));
  await page.getByRole('button',{name:'恢復預設版面',exact:true}).click();assert.deepEqual(await widgetOrder(page),order);await page.getByRole('button',{name:'完成自訂',exact:true}).click();assert.equal(await page.locator('.study-widget-controls').count(),0);
  const original={order:[...order].reverse(),hidden:['countdown','subjects']};const saved=await setup(original,'weekly');assert.deepEqual(await widgetOrder(saved),original.order.filter(id=>!original.hidden.includes(id)));assert.deepEqual(await saved.evaluate(()=>JSON.parse(localStorage.getItem('vetexam.home.layout.v1'))),original);await saved.getByRole('button',{name:'自訂首頁',exact:true}).click();for(const w of widths){await saved.setViewportSize({width:w,height:1000});await geometry(saved,w,true);}await saved.close();
  for(const value of ['{broken',{order:['hero','progress','progress'],hidden:['hero','journey','missing']},{order:[],hidden:order}]){const p=await setup(value);await p.locator('h1').waitFor();await p.getByRole('heading',{name:'VetExam 怎麼陪你準備國考？'}).waitFor();assert.equal(await p.locator('.study-welcome [data-widget]').count(),0);await p.getByRole('button',{name:'自訂首頁',exact:true}).click();await p.getByRole('button',{name:'恢復預設版面',exact:true}).click();assert.deepEqual(await widgetOrder(p),order);await p.close();}
 }
 await page.close();assert.deepEqual(errors,[]);writeFileSync(`${out}/validation.json`,JSON.stringify(evidence,null,2));console.log(`PASS ${phase}: screenshots${phase==='after'?', 8 widths/default+saved, toolbar geometry/targets, keyboard, persistence, hide/undo/restore, drag, reset, malformed storage/core protection':''}`);
}finally{await browser.close();}
