import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.TEST_BASE_URL||'http://localhost:3270',phase=process.env.UI_PHASE||'after';
const out=`.tmp/ui-phase3/${phase}`;mkdirSync(out,{recursive:true});
const widths=[320,375,430,768,1024,1280,1440,1920];
const subjects=['獸醫病理學','獸醫藥理學','獸醫實驗診斷學','獸醫普通疾病學','獸醫傳染病學','獸醫公共衛生學'];
const question={id:901,questionSetId:1,questionNumber:1,subject:subjects[0],question:'有關細胞與組織的變化，下列敘述何者正確？此長題幹供畫面換行驗證。'.repeat(3),options:['觀察組織的構造與臨床資訊，綜合判讀。','乙','丙','丁'],answer:'A',explanation:'這是測試用解析。\n請綜合判讀組織與臨床資訊。',examYear:2026,questionSetName:'UI fixture',userAnswer:'B',note:'既有筆記'};
const note={id:'00000000-0000-4000-8000-000000000001',type:'official',status:'published',visibility:'public',title:'病理學章節重點與臨床判讀',subject:subjects[0],chapter:'腫瘤',content:'本段為介面測試資料。觀察組織變化時，需要留意細胞形態、分布與周邊組織。\n\n'.repeat(10),authorName:'VetExam',updatedAt:'2026-09-25T00:00:00Z',helpful:12,isFavorite:false,isHelpful:false,canEdit:false,canReact:true};
const community={...note,id:'00000000-0000-4000-8000-000000000002',type:'community',status:'active',title:'我的腫瘤複習筆記',authorName:'測試作者',canEdit:true};
const b=await chromium.launch({channel:'msedge',headless:true});const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push({url:p.url(),message:e.message}));let noteState='normal',authRequests=0;
await p.addInitScript(q=>{if(localStorage.getItem('__phase3'))return;localStorage.setItem('__phase3','1');localStorage.setItem('favorites',JSON.stringify([q]));localStorage.setItem('wrongQuestions',JSON.stringify([q,{...q,id:902,questionNumber:2,question:'第二題，請選出正確答案。'}]));},question);
await p.route('**/api/**',r=>r.fulfill({json:{}}));
await p.route('**/api/auth/get-session**',r=>r.fulfill({json:null}));
await p.route('**/api/admin/status',r=>r.fulfill({json:{isAdmin:false}}));
await p.route('**/api/quiz?**',r=>r.fulfill({json:new URL(r.request().url()).searchParams.has('settings')?{availability:subjects.map(subject=>({subject,year:2026,count:40})),chapterAvailability:subjects.map(subject=>({subject,chapter:'腫瘤',year:2026,count:20}))}:{questions:[question]}}));
await p.route('**/api/stats/weekly-most-missed',r=>r.fulfill({json:{question:{question_id:901,question_number:1,exam_subject:subjects[0],question:question.question,wrong_attempts:12,total_attempts:20},min_attempts:10}}));
await p.route('**/api/stats/difficulty?**',r=>r.fulfill({json:{total:20,rate:40,label:'偏難'}}));
await p.route('**/api/stats/option-distribution?**',r=>r.fulfill({json:{total:0,sufficient:false,min_attempts:5,options:[]}}));
await p.route('**/api/notes**',async r=>{if(noteState==='loading')await new Promise(resolve=>setTimeout(resolve,1500));if(noteState==='error')return r.fulfill({status:503,json:{error:'筆記暫時無法讀取。'}});const url=new URL(r.request().url()),id=url.pathname.split('/')[3];const n=id===community.id?community:note;if(r.request().method()==='PATCH'){const body=r.request().postDataJSON();if(body.kind==='favorite')n.isFavorite=body.active;else{n.isHelpful=body.active;n.helpful+=body.active?1:-1}}return r.fulfill({json:id?{note:n,signedIn:true}:{notes:noteState==='empty'?[]:[{...note,content:note.content.slice(0,180)},{...community,content:community.content.slice(0,180)}],page:Number(url.searchParams.get('page')||1),hasMore:true,signedIn:true}})});
await p.route('**/api/auth/sign-in/email',r=>{authRequests++;return r.fulfill({status:401,json:{code:'INVALID_EMAIL_OR_PASSWORD',message:'帳號或密碼錯誤'}})});
await p.route('**/api/auth/sign-up/email',r=>{authRequests++;return r.fulfill({status:422,json:{code:'USER_ALREADY_EXISTS',message:'此 Email 已註冊'}})});
async function capture(name){for(const width of widths){await p.setViewportSize({width,height:900});if(phase==='after'){
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflow ${width}`);
 assert(await p.locator('dialog').evaluateAll(items=>items.every(el=>el.scrollWidth<=el.clientWidth)),`${name} dialog overflow ${width}`);
 const controls=await p.locator('main button,main input,main select,main textarea,header button,header summary').evaluateAll(items=>items.filter(el=>el.getClientRects().length).map(el=>({text:el.getAttribute('aria-label')||el.textContent?.trim().slice(0,32)||el.tagName,height:el.getBoundingClientRect().height})));
 assert(controls.every(el=>el.height>=43),`${name} short controls ${width}: ${JSON.stringify(controls.filter(el=>el.height<43))}`);
 }await p.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true})}}
try{
await p.goto(base);await p.getByRole('button',{name:'挑戰這題',exact:false}).waitFor();await capture('home');
writeFileSync(`${out}/home-links.json`,JSON.stringify(await p.locator('a[href]').evaluateAll(items=>items.map(el=>({href:el.getAttribute('href'),label:el.textContent.trim()})).sort((a,b)=>a.href.localeCompare(b.href))),null,2));
if(phase==='after'){
 assert.equal(await p.locator('a[href^="tel:"]').count(),0);assert.equal(await p.locator('a[href="https://www.instagram.com/vetexam.tw/"]').count(),1);
 await p.setViewportSize({width:320,height:900});const menu=p.locator('summary[aria-label="開啟導覽選單"]');await menu.focus();await p.keyboard.press('Enter');await p.getByRole('navigation',{name:'行動版導覽'}).waitFor();assert(await p.getByRole('navigation',{name:'行動版導覽'}).getByRole('link',{name:'國考題庫',exact:true}).isVisible());await menu.press('Enter');await menu.press('Enter');await p.getByRole('navigation',{name:'行動版導覽'}).getByRole('link',{name:'國考題庫',exact:true}).click();await p.waitForURL('**/subjects');await p.goto(base);
 await p.getByRole('button',{name:'挑戰這題',exact:false}).click();await p.getByRole('group',{name:'本週魔王題答案選項'}).getByRole('button').first().click();await p.getByRole('region',{name:'答案與解析'}).waitFor();await p.keyboard.press('Escape');
}
await p.goto(base+'/subjects');await p.getByRole('button',{name:'選擇獸醫病理學，設定練習'}).waitFor();await capture('subjects');
await p.getByRole('button',{name:'選擇獸醫病理學，設定練習'}).click();await p.getByText('符合條件共有 40 題',{exact:true}).waitFor();await p.locator('details summary').click();await capture('subject-settings');
if(phase==='after'){await p.keyboard.press('Tab');assert(await p.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));await p.getByRole('button',{name:'腫瘤',exact:true}).click();await p.getByText('符合條件共有 20 題',{exact:true}).waitFor();const url=new URL(await p.getByRole('link',{name:'開始刷題 →',exact:true}).getAttribute('href'),base);assert.equal(JSON.parse(url.searchParams.get('groups'))[0].chapter,'腫瘤');await p.keyboard.press('Escape');assert.equal(await p.getByRole('dialog').count(),0);assert(await p.getByRole('button',{name:'選擇獸醫病理學，設定練習'}).evaluate(el=>el===document.activeElement));}
await p.goto(base+'/favorites');await p.locator('article').waitFor();await capture('favorites');
await p.goto(base+'/wrong');await p.locator('article').first().waitFor();await capture('wrong');
if(phase==='after'){await p.getByLabel('第 1 題的筆記').fill('新的測試筆記');await p.getByLabel('第 1 題的筆記').blur();assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('wrongQuestions'))[0].note),'新的測試筆記');}
await p.goto(base+'/wrong-test');await p.getByRole('button',{name:'確認答案',exact:true}).waitFor();await capture('wrong-test');
if(phase==='after'){await p.getByRole('button',{name:/^A\./}).click();await p.getByRole('button',{name:'確認答案',exact:true}).click();await p.getByText('✓ 答對了',{exact:true}).waitFor();await p.getByRole('button',{name:'下一題 →',exact:true}).click();await p.getByRole('button',{name:/^B\./}).click();await p.getByRole('button',{name:'確認答案',exact:true}).click();await p.getByRole('button',{name:'下一題 →',exact:true}).click();await p.getByRole('heading',{name:'錯題複習完成',exact:false}).waitFor();assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('wrongQuestions')).length),2);}
if(phase==='after'){
 await p.goto(base+'/wrong');await p.getByRole('button',{name:'已掌握，移除第 1 題',exact:true}).click();assert.equal(await p.locator('article').count(),1);
 await p.goto(base+'/questions?started=1&mode=practice');await p.getByRole('button',{name:'已收藏',exact:true}).click();await p.goto(base+'/favorites');await p.getByRole('heading',{name:'還沒有收藏的題目',exact:true}).waitFor();
}
await p.goto(base+'/notes');await p.getByRole('heading',{name:note.title}).waitFor();await capture('notes');
await p.goto(base+'/notes/'+note.id);await p.getByRole('heading',{name:note.title}).waitFor();await capture('note-official');
await p.goto(base+'/notes/'+community.id);await p.getByRole('heading',{name:community.title}).waitFor();await capture('note-community');
for(const route of ['login','register']){await p.goto(base+'/'+route);await p.locator('form').waitFor();await capture(route);if(phase==='after'){if(route==='register')await p.getByLabel('姓名',{exact:true}).fill('Fixture');await p.getByLabel('Email',{exact:true}).fill('fixture@example.test');await p.getByLabel('密碼',{exact:true}).fill('password123');if(route==='register')await p.getByLabel('確認密碼',{exact:true}).fill('password123');await p.getByRole('button',{name:route==='login'?'登入':'註冊',exact:true}).click();await p.locator('main').getByRole('alert').waitFor();}}
if(phase==='after'){
 assert.equal(authRequests,2);
 await p.goto(base+'/register');await p.getByLabel('姓名',{exact:true}).fill('Fixture');await p.getByLabel('Email',{exact:true}).fill('fixture@example.test');await p.getByLabel('密碼',{exact:true}).fill('password123');await p.getByLabel('確認密碼',{exact:true}).fill('different123');await p.getByRole('button',{name:'註冊',exact:true}).click();await p.locator('main').getByRole('alert').waitFor();assert.equal(authRequests,2,'mismatched passwords must not submit');
 for(const route of ['login','register']){
 await p.route('**/api/auth/'+(route==='login'?'sign-in':'sign-up')+'/email',r=>r.fulfill({json:{token:'fixture-only',user:{id:'fixture',name:'Fixture',email:'fixture@example.test'}}}));
 await p.goto(base+'/'+route);if(route==='register')await p.getByLabel('姓名',{exact:true}).fill('Fixture');await p.getByLabel('Email',{exact:true}).fill('fixture@example.test');await p.getByLabel('密碼',{exact:true}).fill('password123');if(route==='register')await p.getByLabel('確認密碼',{exact:true}).fill('password123');await p.getByRole('button',{name:route==='login'?'登入':'註冊',exact:true}).click();await p.waitForURL(base+'/');
 }
 await p.emulateMedia({reducedMotion:'reduce'});await p.goto(base+'/subjects');assert.equal(await p.getByRole('button',{name:'選擇獸醫病理學，設定練習'}).evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 for(const state of ['empty','error','loading']){noteState=state;await p.goto(base+'/notes');if(state==='empty')await p.getByText('目前這個範圍還沒有可用的筆記。',{exact:true}).waitFor();else if(state==='error')await p.locator('main').getByRole('alert').waitFor();else await p.getByRole('status').first().waitFor();await p.screenshot({path:`${out}/notes-${state}.png`,fullPage:true})}
 await p.evaluate(()=>{localStorage.setItem('favorites','[]');localStorage.setItem('wrongQuestions','[]')});for(const route of ['favorites','wrong']){await p.goto(base+'/'+route);await p.getByRole('heading',{level:2}).waitFor();await p.screenshot({path:`${out}/${route}-empty.png`,fullPage:true})}
}
assert.deepEqual(errors,[]);console.log(`PASS Phase 3 ${phase}: 11 views, 8 widths, screenshots${phase==='after'?', navigation/chapters/wrong-test/auth/error/empty/loading/reduced-motion':''}`);
}finally{await b.close()}
