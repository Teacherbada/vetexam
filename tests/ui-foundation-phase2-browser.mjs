import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const phase=process.env.UI_PHASE||'after', base=process.env.TEST_BASE_URL||'http://localhost:3260';
const dir=`.tmp/ui-phase2/${phase}`;mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const p=await browser.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="#edf4f8"/><circle cx="450" cy="250" r="150" fill="#356748"/><text x="450" y="260" text-anchor="middle" fill="white" font-size="36">Image fixture</text></svg>');
const questions=[{id:991,questionSetId:1,questionNumber:1,subject:'獸醫病理學',question:'關於動物組織病理的觀察，下列敘述何者最適當？這是供介面驗證使用的長題幹。'.repeat(3),options:['第一個選項包含較長的文字，用來確認窄螢幕上能夠自然換行。','第二個選項','第三個選項','第四個選項','第五個選項'],answer:'B',explanation:'應綜合判讀組織變化與臨床資訊。\n此文字僅為測試資料。',imageDataUrl:image,examYear:2026,questionSetName:'UI fixture'},{id:992,questionSetId:1,questionNumber:2,subject:'獸醫病理學',question:'第二題：一般 A–D 題型。',options:['甲','乙','丙','丁'],answer:'A',explanation:'第二題解析。',examYear:2026,questionSetName:'UI fixture'}];
let responseMode='normal';
await p.route('**/api/**',r=>r.fulfill({json:{}}));
await p.route('**/api/auth/get-session**',r=>r.fulfill({json:null}));
await p.route('**/api/admin/status',r=>r.fulfill({json:{isAdmin:false}}));
await p.route('**/api/quiz?**',r=>r.fulfill({json:{questions}}));
await p.route('**/api/stats/difficulty?**',r=>r.fulfill({json:{total:0,rate:null,label:'統計資料累積中'}}));
await p.route('**/api/stats/answers',r=>r.fulfill({json:{success:true,recorded:false}}));
await p.route('**/api/admin/dashboard',r=>r.fulfill({json:{users:{total:125,today:3,week:18},dailyUsers:[{date:'2026-09-23',count:2},{date:'2026-09-24',count:5},{date:'2026-09-25',count:3}],banks:{total:24,public:20,private:4},questions:{total:1920},subjects:[{label:'獸醫病理學',count:10}],years:[{label:'115',count:6}],plans:[{plan:'free',status:'active',count:100}],reports:[{status:'open',count:2}]}}));
await p.route('**/api/admin/health',r=>r.fulfill({json:{checked_at:'2026-09-25T00:00:00Z',last_24_hours:0,last_7_days:0,errors:[]}}));
await p.route('**/api/admin/questions?**',r=>r.fulfill({json:{summary:{total:200,missing_answer:2,missing_explanation:10,missing_both:1,invalid:0,answer_null:2,answer_blank:0},sets:[{id:1,name:'115 年獸醫病理學',exam_year:2026,exam_subject:'獸醫病理學',visibility:'public',total:200,missing_answer:2,missing_explanation:10}],questions:questions.map(q=>({...q,question_number:q.questionNumber,question_set_id:1,question_set_name:'115 年獸醫病理學',exam_year:2026,option_a:q.options[0],option_b:q.options[1],option_c:q.options[2],option_d:q.options[3]})),total:200}}));
for(const name of ['users','reports'])await p.route(`**/api/admin/${name}?**`,async r=>{if(responseMode==='loading')await new Promise(resolve=>setTimeout(resolve,1500));if(responseMode==='error')return r.fulfill({status:503,json:{error:'暫時無法讀取，請稍後重試。'}});return r.fulfill({json:{total:responseMode==='empty'?0:1,pageSize:50,[name]:responseMode==='empty'?[]:name==='users'?[{id:'fixture',name:'測試會員',email:'fixture.long.email@example.test',created_at:'2026-09-25T00:00:00Z',plan:'free',status:'active',effective_plan:'free',bank_count:2}]:[{id:'fixture',user_id:'fixture',user_email:'fixture@example.test',category:'bug',message:'測試回報內容。'.repeat(12),context:'測試情境',status:'open',created_at:'2026-09-25T00:00:00Z',updated_at:'2026-09-25T00:00:00Z'}]}})});
async function capture(name){for(const width of [320,375,430,768,1024,1280,1440]){await p.setViewportSize({width,height:900});await p.screenshot({path:`${dir}/${name}-${width}.png`,fullPage:true});if(phase==='after')assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflow ${width}`)}}
try{
await p.goto(base+'/questions?started=1&mode=practice');await p.getByRole('group',{name:'答案選項'}).waitFor();await capture('questions');
if(phase==='after'){
 assert(await p.getByRole('group',{name:'答案選項'}).getByRole('button').evaluateAll(items=>items.every(el=>el.getBoundingClientRect().height>=44)));
 const zoom=p.getByRole('button',{name:/放大查看/});await zoom.focus();await p.keyboard.press('Enter');await p.getByRole('dialog').waitFor();await p.keyboard.press('Tab');assert(await p.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));await p.keyboard.press('Escape');assert(await zoom.evaluate(el=>el===document.activeElement));
}
await p.getByRole('group',{name:'答案選項'}).getByRole('button').first().click();await p.getByRole('region',{name:'答案與解析'}).waitFor();await capture('questions-wrong');
if(phase==='after'){await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.getByRole('progressbar',{name:'已完成題數比例'}).locator('span').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');await p.getByRole('button',{name:'下一題',exact:true}).scrollIntoViewIfNeeded();assert(await p.getByRole('button',{name:'下一題',exact:true}).evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}));}
await p.getByRole('button',{name:'下一題',exact:true}).click();await p.setViewportSize({width:375,height:812});assert.equal(await p.getByRole('group',{name:'答案選項'}).count(),1);assert.equal(await p.getByRole('group',{name:'答案選項'}).getByRole('button').count(),4);await p.getByRole('group',{name:'答案選項'}).getByRole('button').first().focus();await p.keyboard.press('Space');await p.getByText('✓ 答對了，正確答案：A',{exact:true}).waitFor();
for(const screen of ['dashboard','questions','users','reports']){await p.goto(base+'/ui-phase2-fixture?screen='+screen);await p.getByRole('heading',{level:1}).waitFor();await p.waitForTimeout(400);await capture('admin-'+screen);
if(phase==='after'&&screen==='users'){await p.getByLabel('搜尋 email',{exact:true}).fill('fixture@example.test');const request=p.waitForRequest(r=>r.url().includes('/api/admin/users?')&&new URL(r.url()).searchParams.get('email')==='fixture@example.test');await p.getByRole('button',{name:'搜尋',exact:true}).click();await request;await p.getByRole('region',{name:'會員資料表'}).waitFor();await p.setViewportSize({width:320,height:900});const table=p.getByRole('region',{name:'會員資料表'});await table.focus();await p.keyboard.press('ArrowRight');assert(await table.evaluate(el=>getComputedStyle(el).overflowX==='auto'));}
if(phase==='after'&&screen==='reports'){const request=p.waitForRequest(r=>r.url().includes('/api/admin/reports?')&&new URL(r.url()).searchParams.get('status')==='open');await p.getByLabel('回報狀態',{exact:true}).selectOption('open');await request;}
}
if(phase==='after')for(const state of ['empty','error','loading']){responseMode=state;await p.goto(base+'/ui-phase2-fixture?screen=users');if(state==='loading')await p.getByRole('status').first().waitFor();else if(state==='error')await p.locator('main').getByRole('alert').waitFor();else await p.getByText('沒有符合條件的會員。',{exact:true}).waitFor();await p.screenshot({path:`${dir}/admin-${state}.png`,fullPage:true})}
assert.deepEqual(errors,[]);console.log('PASS '+phase+': questions + 4 admin views, 7 widths, '+(phase==='after'?'keyboard/dialog/empty/error/loading':'baseline screenshots'));
}finally{await browser.close()}
