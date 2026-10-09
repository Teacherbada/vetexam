// Local fixtures only; browser API data is intercepted, no real sessions/questions are written.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
function load(source,mocks={}) { const exports={}; new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>mocks[name],exports);return exports; }
const taxonomy=load(await readFile(new URL('../data/exam-chapters.ts',import.meta.url),'utf8'));
const input=load(await readFile(new URL('../lib/ai-question-input.ts',import.meta.url),'utf8'),{'@/data/exam-chapters':taxonomy});
const example=JSON.parse(await readFile(new URL('../public/examples/ai-questions.json',import.meta.url),'utf8'));
const fixtureDir=new URL('../app/ai-bank-test-fixture/',import.meta.url);
let created=false,server,browser;
const base='http://127.0.0.1:3119';
try {
  await mkdir(fixtureDir);created=true;
  await writeFile(new URL('page.tsx',fixtureDir),"import Admin from '../admin/ai-questions/AIQuestionsAdmin'; import Practice from '../ai-questions/AIPractice'; export default async function Page({searchParams}:{searchParams:Promise<{mode?:string}>}) { return (await searchParams).mode==='practice'?<Practice/>:<Admin/>; }\n");
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3119'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log=''; server.stdout.on('data',c=>{log=(log+c).slice(-10000)});server.stderr.on('data',c=>{log=(log+c).slice(-10000)});
  let ready=false;
  for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/admin/status');if(r.status===401){ready=true;break;}}catch{} if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}
  assert(ready,'server not ready '+log);
  for(const p of ['/admin/ai-questions','/ai-questions']) {const r=await fetch(base+p,{redirect:'manual'});assert.equal(r.status,307);assert(r.headers.get('location').includes('/login'));}
  for(const method of ['GET','POST']) {
    const init=method==='POST'?{method,headers:{'content-type':'application/json'},body:'{}'}:undefined;
    assert.equal((await fetch(base+'/api/admin/ai-questions',init)).status,403);
    assert.equal((await fetch(base+'/api/ai-questions',init)).status,401);
  }
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/auth/**',r=>r.fulfill({json:null}));
  await page.route('**/api/admin/status',r=>r.fulfill({json:{isAdmin:false}}));
  let row=null,imports=0,answers=0;
  const batchId='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002';
  const requests=[];
  await page.route('**/api/admin/ai-questions**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='GET') return route.fulfill({json:url.searchParams.has('batch')?{questions:row?[row]:[]}:{batches:row?[{id:batchId,name:example.name,total:1,drafts:row.status==='draft'?1:0,published:row.status==='published'?1:0,result:{excluded:[{index:2,errors:['答案必須是唯一的 A、B、C 或 D']}]}}]:[],next:null}});
    const body=request.postDataJSON();requests.push(body);
    if(body.action==='preview'){const parsed=input.parseAIBatch(body.input);return route.fulfill({json:{rows:parsed.rows,valid:parsed.rows.filter(r=>!r.errors.length).length,invalid:parsed.rows.filter(r=>r.errors.length).length,token:'preview-fixture'}});}
    if(body.action==='import'){imports++;row={id,position:1,revision:1,content:input.parseAIQuestion(body.input.questions[0]).question,status:'draft',review_status:'pending',reviewed_at:null};await new Promise(r=>setTimeout(r,300));return route.fulfill({json:{batchId,imported:1,excluded:[{index:2}],replayed:false}});}
    assert.equal(body.revision,row.revision);
    if(body.action==='save'){row={...row,content:body.content,status:'draft',review_status:'pending',reviewed_at:null,revision:row.revision+1};}
    if(body.action==='publish'){assert.equal(body.confirmReview,true);row={...row,status:'published',review_status:'approved',reviewed_at:new Date().toISOString(),revision:row.revision+1};}
    return route.fulfill({json:{question:row}});
  });
  await page.goto(base+'/ai-bank-test-fixture');
  const mixed={...example,questions:[example.questions[0],{...example.questions[0],answer:'Z'}]};
  await page.getByLabel('上傳 JSON 檔案').setInputFiles({name:'batch.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(mixed))});
  await page.getByRole('button',{name:'解析並預覽',exact:true}).click();
  await page.getByText(/有效 1 題；有錯誤 1 題/).waitFor();
  assert(await page.getByRole('button',{name:'確認匯入為草稿',exact:true}).isDisabled());
  await page.getByLabel(/我已查看錯誤，明確選擇/).check();
  await page.getByRole('button',{name:'確認匯入為草稿',exact:true}).evaluate(el=>{el.click();el.click();});
  await page.getByText(/匯入完成。 1 題皆為草稿/).waitFor();assert.equal(imports,1);assert.equal(requests.find(r=>r.action==='import').onlyValid,true);
  async function openEditor(label) { const summary=page.locator('summary').filter({hasText:label}); await summary.waitFor(); if (!await summary.locator('..').evaluate(el=>el.open)) await summary.click(); }
  await openEditor('第 1 題｜草稿／待審核');
  await page.getByLabel(/我已人工核對題幹/).check();
  await page.getByRole('button',{name:'確認審核並發布此題',exact:true}).click();
  await page.getByText('已記錄人工審核並發布。',{exact:true}).waitFor();assert.equal(row.status,'published');
  await openEditor('第 1 題｜已發布／已人工審核');
  await page.getByLabel('完整解析',{exact:true}).fill('人工修正的完整解析，保留作答紀錄。');
  await page.getByRole('button',{name:'儲存修改並待審核',exact:true}).click();
  await page.getByText('已儲存為草稿／待審核；原有作答紀錄保留。',{exact:true}).waitFor();assert.equal(row.status,'draft');
  await openEditor('第 1 題｜草稿／待審核');
  assert(!await page.getByLabel(/我已人工核對題幹/).isChecked());
  assert(await page.getByRole('button',{name:'確認審核並發布此題',exact:true}).isDisabled());
  const artifacts=new URL('../.tmp/ai-question-artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
  for(const width of [320,375,768,1280]) {await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'admin overflow '+width);if(width===375)await page.screenshot({path:new URL('admin-375.png',artifacts).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});}
  await page.getByLabel(/我已人工核對題幹/).check();await page.getByRole('button',{name:'確認審核並發布此題',exact:true}).click();await page.getByText('已記錄人工審核並發布。',{exact:true}).waitFor();
  let emptyBank=false; const secondId='00000000-0000-4000-8000-000000000003';
  await page.route('**/api/ai-questions**',route=>{
    const r=route.request();
    if(r.method()==='GET')return route.fulfill({json:{questions:emptyBank?[]:[{id,revision:row.revision,...(({subject,chapter,question,options})=>({subject,chapter,question,options}))(row.content)},{id:secondId,revision:row.revision,...(({subject,chapter,options})=>({subject,chapter,options}))(row.content),question:'第二題 AI 練習'}],next:null}});
    answers++;const body=r.postDataJSON();assert([id,secondId].includes(body.id));
    return route.fulfill({json:{answer:row.content.answer,correct:body.answer===row.content.answer,explanation:row.content.explanation,optionExplanations:row.content.optionExplanations,source:row.content.source,generationMethod:row.content.generationMethod}});
  });
  await page.goto(base+'/ai-bank-test-fixture?mode=practice');
  await page.evaluate(()=>localStorage.setItem('progress',JSON.stringify({existing:{answered:[1],correct:1,wrong:0}})));
  const before=await page.evaluate(()=>JSON.stringify({...localStorage}));
  await page.getByLabel('科目',{exact:true}).selectOption('獸醫公共衛生學');
  await page.getByLabel('章節',{exact:true}).selectOption('獸醫流行病學');
  await page.getByRole('button',{name:'開始 AI 練習',exact:true}).click();
  await page.getByText('AI 試題｜非歷屆國考題',{exact:true}).waitFor();
  assert.equal(await page.getByText('教材來源',{exact:true}).count(),0);
  await page.getByRole('group',{name:'答案選項'}).getByRole('button').first().evaluate(el=>{el.click();el.click();});
  assert.equal(answers,0);
  await page.getByRole('button',{name:'提交答案',exact:true}).evaluate(el=>{el.click();el.click();});
  await page.getByRole('heading',{name:'教材來源'}).waitFor();assert.equal(answers,1);
  await page.getByText('人工修正的完整解析，保留作答紀錄。',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'開啟管理員提供的公開來源'}).count(),0);
  assert.equal(await page.getByText('未提供／未確認',{exact:true}).count(),2);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),before);
  for(const width of [320,375,768,1280]) {await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'practice overflow '+width);if(width===375)await page.screenshot({path:new URL('practice-375.png',artifacts).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});}
  await page.getByRole('button',{name:'下一題',exact:true}).click();await page.getByRole('heading',{name:'第二題 AI 練習',exact:true}).waitFor();
  await page.getByRole('group',{name:'答案選項'}).getByRole('button').first().click();assert.equal(answers,1);await page.getByRole('button',{name:'提交答案',exact:true}).click();await page.getByRole('button',{name:'查看測驗結果',exact:true}).click();
  await page.getByRole('region',{name:'AI 測驗結果'}).getByText('AI 試題｜非歷屆國考題',{exact:true}).waitFor();assert.equal(answers,2);assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),before);
  emptyBank=true;await page.getByRole('button',{name:'重新選擇科目'}).click();await page.getByRole('button',{name:'開始 AI 練習',exact:true}).click();await page.getByText('此分類目前沒有已審核發布的 AI 試題。',{exact:true}).waitFor();assert.equal(await page.getByRole('group',{name:'答案選項'}).count(),0);
  // Existing practice and image question regression through the real quiz component.
  const image='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="green"/></svg>').toString('base64');
  await page.route('**/api/quiz?**',route=>route.fulfill({json:{questions:[{id:991,questionSetId:1,questionNumber:1,subject:'獸醫病理學',question:'既有國考圖片題驗收',options:['a','b','c','d'],answer:'A',explanation:'既有解析',examYear:2026,questionSetName:'fixture',imageUrl:image,imageDataUrl:image,hasImage:true}]}}));
  await page.route('**/api/stats/**',route=>route.fulfill({json:{success:true,available:false}}));
  await page.goto(base+'/questions?started=1&mode=practice');
  await page.getByText('既有國考圖片題驗收',{exact:true}).waitFor();
  const img=page.locator('main img');assert(await img.count()>0);assert(await img.first().evaluate(el=>el.complete&&el.naturalWidth>0));
  await page.getByRole('group',{name:'答案選項',exact:true}).getByRole('button').first().click();
  await page.getByText('既有解析',{exact:true}).waitFor();
  await page.route('**/api/quiz?*settings*',route=>route.fulfill({json:{availability:[],chapterAvailability:[]}}));
  await page.goto(base+'/');await page.locator('.study-banks').getByRole('link',{name:/AI 試題/}).waitFor();assert.equal(await page.locator('.study-banks').getByRole('link',{name:/AI 試題/}).getAttribute('href'),'/ai-questions');
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'home overflow '+width);}
  assert.deepEqual(errors,[]);
  console.log('PASS real anonymous guards; JSON file+invalid preview+explicit subset; double-submit; publish/edit/re-review; stored answer/explanation/source; AI storage isolation; 320/375/768/1280px; existing exam/image practice.');
} finally {
  if(browser)await browser.close();
  if(server)server.kill();
  if(created){await unlink(new URL('page.tsx',fixtureDir)).catch(()=>{});await rmdir(fixtureDir).catch(()=>{});}
  for(const name of ['validator.ts','routes.d.ts']) {
    const generated=new URL('../.next/dev/types/'+name,import.meta.url);
    if((await readFile(generated,'utf8').catch(()=> '')).includes('ai-bank-test-fixture'))await unlink(generated).catch(()=>{});
  }
}
