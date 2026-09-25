import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const png=(w,h,color)=>{const c=createCanvas(w,h);const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);return c.toDataURL('image/png')};
const red=png(80,50,'red'),blue=png(60,40,'blue');
const browser=await chromium.launch({channel:'msedge',headless:true});
const base=process.env.TEST_BASE_URL||'http://localhost:3210';
mkdirSync('.tmp/pdf-review',{recursive:true});
try {
  const p=await browser.newPage({viewport:{width:375,height:812}}); const errors=[]; p.on('pageerror',e=>errors.push(e.message));
  let saved,aiCalls=0,imageCalls=0;
  await p.route('**/api/**',r=>r.fulfill({json:{}}));
  await p.route('**/api/auth/get-session**',r=>r.fulfill({json:{user:{id:'fixture',email:'fixture@example.test',name:'Fixture'},session:{id:'fixture',userId:'fixture',expiresAt:new Date(Date.now()+86400000).toISOString()}}}));
  await p.route('**/api/admin/status',r=>r.fulfill({json:{isAdmin:true}}));
  await p.route('**/api/subscription',r=>r.fulfill({json:{subscription:{plan:'pro',status:'active'}}}));
  await p.route('**/api/question-sets',r=>{if(r.request().method()==='GET')return r.fulfill({json:{questionSets:[]}});saved=r.request().postDataJSON();return r.fulfill({json:{questionSetId:123}})});
  await p.route('**/api/admin/questions/classify',r=>{aiCalls++;return r.fulfill({status:500,json:{error:'No AI in fixture'}})});
  const region=(id,y)=>({id,page:1,x:40,y,width:80,height:50,source:'raster'});
  await p.route('**/api/pdf',r=>r.fulfill({json:{fileHash:'a'.repeat(64),parserVersion:2,questions:[
    {id:1,questionNumber:1,subject:'獸醫病理學',question:'圖片題，請觀察兩張圖片。',options:['甲','乙','丙','丁'],answer:'A',explanation:'',pageNumber:1,endPage:1,regions:[region('one',150),region('two',220)],hasImage:true,confidence:100,warnings:[]},
    {id:2,questionNumber:3,subject:'獸醫病理學',question:'這題跨頁且缺少選項。',options:['甲','','丙','丁'],answer:null,explanation:'',pageNumber:1,endPage:2,regions:[],hasImage:false,confidence:40,warnings:['題號不連續','跨頁','缺選項','沒答案'],rawText:'3. 這題跨頁且缺少選項。\nA. 甲\nC. 丙\nD. 丁'},
  ]}}));
  await p.route('**/api/pdf/images-v10',r=>{imageCalls++;assert(r.request().postData().includes('regions'));return r.fulfill({json:{imageDataUrls:[red,blue],imageDataUrl:red,extractionMode:'pdf-region-render-v10'}})});
  await p.goto(base+'/pdf');await p.locator('#exam-subject').selectOption('獸醫病理學');await p.locator('#exam-year').selectOption({index:1});
  await p.getByLabel('選擇國考 PDF 檔案').setInputFiles({name:'115-test.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-fixture')});
  await p.getByRole('button',{name:'開始解析 PDF',exact:true}).click();
  await p.getByRole('heading',{name:'需要確認',exact:true}).waitFor();
  await p.getByRole('button',{name:'題目確認完成，下一步：章節分類 →',exact:true}).click();
  await p.getByText('請先逐題確認標記項目；沒有可靠答案可保持空白。',{exact:true}).waitFor();
  await p.getByLabel('需要確認篩選').selectOption('缺選項');await p.getByRole('button',{name:'第 3 題 ·',exact:false}).click();
  await p.getByLabel('第 2 題題號',{exact:true}).fill('2');await p.getByLabel('第 2 題選項 B',{exact:true}).fill('乙');await p.getByLabel('第 2 題答案',{exact:true}).selectOption('B');
  await p.getByRole('button',{name:'全部展開',exact:true}).click();
  await p.locator('#pdf-question-1').scrollIntoViewIfNeeded();
  await p.locator('#pdf-question-1').getByRole('button',{name:'移除圖片 1',exact:true}).waitFor();
  const first=p.locator('#pdf-question-1'),second=p.locator('#pdf-question-2');
  await first.getByRole('button',{name:'上移圖片 2',exact:true}).click();
  assert.equal(await first.getByRole('img').first().getAttribute('src'),blue);
  await first.getByLabel('圖片 1 改配到其他題',{exact:true}).selectOption('2');
  await second.getByRole('button',{name:'移除圖片 1',exact:true}).waitFor();
  assert.equal(await second.getByRole('img').first().getAttribute('src'),blue);
  await second.getByLabel('圖片 1 改配到其他題',{exact:true}).selectOption('1');
  await first.getByRole('button',{name:'上移圖片 2',exact:true}).waitFor();
  for(const width of [320,375,768,1280]){
    await p.setViewportSize({width,height:900});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);
    await p.screenshot({path:`.tmp/pdf-review/${width}.png`,fullPage:true});
  }
  await first.getByRole('button',{name:'已人工確認',exact:true}).click();await second.getByRole('button',{name:'已人工確認',exact:true}).click();
  await p.getByRole('button',{name:'題目確認完成，下一步：章節分類 →',exact:true}).click();
  assert.equal(await p.getByLabel('分類方式').inputValue(),'later');
  await p.getByRole('button',{name:'確認匯入私人題庫',exact:true}).click();await p.getByRole('heading',{name:'✓ 已成功匯入 2 題',exact:true}).waitFor();
  assert.equal(saved.fileHash,'a'.repeat(64));assert.deepEqual(saved.questions.map(q=>q.questionNumber),[1,2]);assert.equal(saved.questions[1].answer,'B');assert.equal(saved.questions[1].imageDataUrl,null);
  const dimension=await p.evaluate(src=>new Promise(resolve=>{const i=new Image();i.onload=()=>resolve([i.width,i.height]);i.src=src}),saved.questions[0].imageDataUrl);
  assert.deepEqual(dimension,[80,106]);assert.equal(aiCalls,0);assert.equal(imageCalls,1);assert.deepEqual(errors,[]);
  console.log('PASS mobile 320/375/768/1280, review queue, edits, image movement/reordering, lossless multi-image PNG, original file hash, no AI, successful import (mock only)');
} finally {await browser.close()}
