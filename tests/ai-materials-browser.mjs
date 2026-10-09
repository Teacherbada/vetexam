// Real components, intercepted API fixtures; never writes production data or calls a model.
import assert from 'node:assert/strict';
import { readFile,mkdir,writeFile,unlink,rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sourceText } from './ai-material-fixtures.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixtureDir=new URL('../app/ai-material-test-fixture/',import.meta.url),base='http://127.0.0.1:3120';
const materialId='00000000-0000-4000-8000-000000000101',jobId='00000000-0000-4000-8000-000000000102',batchId='00000000-0000-4000-8000-000000000103';
const pages=[{page:1,text:sourceText,hash:'fixture',usable:true,visual:false,warning:'請對照原頁确认文字順序。'},{page:2,text:'',hash:'blank',usable:false,visual:true,warning:'文字不足：請先 OCR。'}];
const material={id:materialId,filename:'教學教材.pdf',pages};
const q=JSON.parse(await readFile(new URL('../public/examples/ai-questions.json',import.meta.url),'utf8')).questions[0];
let created=false,server,browser;
try {
  await mkdir(fixtureDir);created=true;
  await writeFile(new URL('page.tsx',fixtureDir),"import Materials from '../admin/ai-materials/AIMaterialsAdmin';import Questions from '../admin/ai-questions/AIQuestionsAdmin';export default async function Page({searchParams}:{searchParams:Promise<{review?:string}>}){return (await searchParams).review?<Questions/>:<Materials/>;}\n");
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3120'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';server.stdout.on('data',c=>log=(log+c).slice(-12000));server.stderr.on('data',c=>log=(log+c).slice(-12000));
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/admin/status')).status===401){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}assert(ready,log);
  assert.equal((await fetch(base+'/admin/ai-materials',{redirect:'manual'})).status,307);
  for(const path of ['/api/admin/ai-materials','/api/admin/ai-materials?material='+materialId+'&pdf=1'])assert.equal((await fetch(base+path)).status,403);
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/auth/**',r=>r.fulfill({json:null}));await page.route('**/api/admin/status',r=>r.fulfill({json:{isAdmin:false}}));
  let keyConfigured=false,uploaded=false,job=null,items=[],starts=0,steps=0,failedOnce=false;
  await page.route('**/api/admin/ai-materials**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='GET'){
      if(url.searchParams.has('job'))return route.fulfill({json:{job,items}});
      if(url.searchParams.has('material'))return route.fulfill({json:{material}});
      return route.fulfill({json:{jobs:job?[job]:[],materials:uploaded?[material]:[],keyConfigured}});
    }
    if(request.headers()['content-type'].includes('multipart/form-data')){uploaded=true;return route.fulfill({json:{material}});}
    const b=request.postDataJSON();
    if(b.action==='estimate'){if(b.spec.end===2)return route.fulfill({status:400,json:{error:'選取範圍有掃描頁，請先 OCR'}});return route.fulfill({json:{estimateMicroUSD:b.spec.count*16640}});}
    if(b.action==='start'){starts++;assert.equal(b.confirmText,true);assert.equal(b.confirmCost,true);assert.equal(b.estimateMicroUSD,49920);job={id:jobId,batch_id:batchId,spec:b.spec,model:'gpt-4.1-mini-2025-04-14',reserved_micro_usd:49920};items=[1,2,3].map(position=>({position,status:'pending',error:null,actual_micro_usd:null}));return route.fulfill({json:{jobId,batchId,replayed:false}});}
    if(b.action==='step') {steps++;await new Promise(r=>setTimeout(r,150));const item=items.find(i=>i.status==='pending');if(!item)return route.fulfill({json:{stopped:true,reason:'沒有尚未開始的題目'}});if(item.position===2&&!failedOnce){failedOnce=true;item.status='failed';item.error='模型拒絕，教材不足；不重試';return route.fulfill({json:{stopped:true,reason:item.error}});}item.status='done';item.actual_micro_usd=720;return route.fulfill({json:{stopped:false}});}
    throw Error('unexpected action');
  });
  await page.goto(base+'/ai-material-test-fixture');await page.getByText(/伺服器尚未設定 OPENAI_API_KEY/).waitFor();
  await page.getByLabel('教材 PDF',{exact:true}).setInputFiles(new URL('../public/examples/ai-material-sample.pdf',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  await page.getByText(sourceText,{exact:true}).waitFor();assert.equal(steps,0);assert.equal(starts,0);
  await page.getByLabel('科目',{exact:true}).selectOption('獸醫公共衛生學');await page.getByLabel('既有章節',{exact:true}).selectOption('獸醫流行病學');
  await page.getByLabel('結束 PDF 頁次',{exact:true}).fill('2');await page.getByRole('button',{name:'檢查範圍與估算費用（不呼叫 AI）'}).click();await page.getByRole('status').filter({hasText:'OCR'}).waitFor();assert.equal(steps,0);
  await page.getByLabel('結束 PDF 頁次',{exact:true}).fill('1');await page.getByRole('button',{name:'檢查範圍與估算費用（不呼叫 AI）'}).click();await page.getByText('USD 0.04992',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'開始生成',exact:true}).isDisabled());assert.equal(steps,0);
  keyConfigured=true;await page.reload();await page.getByLabel('已上傳教材（最近 100 份）').selectOption(materialId);
  await page.getByLabel('科目',{exact:true}).selectOption('獸醫公共衛生學');await page.getByLabel('既有章節',{exact:true}).selectOption('獸醫流行病學');await page.getByRole('button',{name:'檢查範圍與估算費用（不呼叫 AI）'}).click();
  await page.getByLabel(/我已逐頁對照原稿/).check();await page.getByLabel(/我同意將所選擷取文字/).check();
  const artifacts=new URL('../.tmp/ai-material-artifacts/',import.meta.url);await mkdir(artifacts,{recursive:true});
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'material overflow '+width);if(width===375)await page.screenshot({path:new URL('preview-375.png',artifacts).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});}
  await page.getByRole('button',{name:'開始生成',exact:true}).evaluate(el=>{el.click();el.click();});await page.getByRole('status').filter({hasText:'教材不足'}).waitFor();assert.equal(starts,1);assert.equal(steps,2);assert.equal(items[0].status,'done');assert.equal(items[2].status,'pending');
  await page.reload();await page.getByLabel('歷次工作（最近 100 批）').selectOption(jobId);await page.getByRole('button',{name:'繼續尚未開始的題目'}).click();await page.getByText('本批處理完畢；草稿仍需人工審核後發布。',{exact:true}).waitFor();assert.equal(steps,3);assert.equal(items[1].status,'failed');
  const originalLink=page.getByRole('link',{name:'查看本批草稿、逐題審核與批次發布'});assert.equal(await originalLink.getAttribute('href'),'/admin/ai-questions?batch='+batchId);
  let row={id:materialId,position:1,content:{...q,source:{...q.source,pdfPages:'1'}},revision:1,status:'draft',review_status:'pending',reviewed_at:null,source_material_id:materialId},published=0,deleted=0;
  await page.route('**/api/admin/ai-questions**',route=>{
    const request=route.request(),url=new URL(request.url());if(request.method()==='GET')return route.fulfill({json:url.searchParams.has('batch')?{questions:row?[row]:[]}:{batches:[{id:batchId,name:'教材測試',total:row?1:0,drafts:row?.status==='draft'?1:0,published:row?.status==='published'?1:0,result:{}}],next:null}});
    const b=request.postDataJSON();if(b.action==='publishBatch'){assert.equal(b.confirmReview,true);assert.deepEqual(b.questions,[{id:row.id,revision:row.revision}]);published++;row={...row,revision:row.revision+1,status:'published',review_status:'approved',reviewed_at:new Date().toISOString()};return route.fulfill({json:{published:1}});}
    if(b.action==='unpublish')row={...row,revision:row.revision+1,status:'draft',review_status:'pending',reviewed_at:null};
    if(b.action==='delete'){assert.equal(b.confirmDelete,true);deleted++;row=null;}
    return route.fulfill({json:{question:row}});
  });
  await page.goto(base+'/ai-material-test-fixture?review=1&batch='+batchId);await page.locator('summary').filter({hasText:'第 1 題｜草稿'}).click();
  assert.equal(await page.getByRole('link',{name:'對照原始 PDF 第 1 頁（僅管理員）'}).getAttribute('href'),'/api/admin/ai-materials?material='+materialId+'&pdf=1#page=1');
  assert(await page.getByRole('button',{name:/批次發布已逐題確認的/}).isDisabled());await page.getByLabel(/我已人工核對題幹/).check();await page.getByRole('button',{name:/批次發布已逐題確認的 1 題/}).click();await page.getByText('已將 1 題人工審核確認的草稿發布。',{exact:true}).waitFor();assert.equal(published,1);
  await page.locator('summary').filter({hasText:'第 1 題｜已發布'}).click();await page.getByRole('button',{name:'撤回為草稿',exact:true}).click();await page.locator('summary').filter({hasText:'第 1 題｜草稿'}).click();
  await page.getByLabel(/確認刪除此草稿/).check();await page.getByRole('button',{name:'刪除草稿',exact:true}).click();await page.getByText('草稿已刪除；既有作答紀錄保留。',{exact:true}).waitFor();assert.equal(deleted,1);assert.deepEqual(errors,[]);
  console.log('PASS material auth; upload/preview/estimate never generate; missing key; OCR gate; cost confirmation; double click; partial failure/reload/resume; original PDF link; batch review/publish/delete; 320/375/768/1280px.');
}finally{
  if(browser)await browser.close();if(server)server.kill();if(created){await unlink(new URL('page.tsx',fixtureDir)).catch(()=>{});await rmdir(fixtureDir).catch(()=>{});}
  for(const name of ['validator.ts','routes.d.ts']){const path=new URL('../.next/dev/types/'+name,import.meta.url);if((await readFile(path,'utf8').catch(()=> '')).includes('ai-material-test-fixture'))await unlink(path).catch(()=>{});}
}
