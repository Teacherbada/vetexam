// All writes use ephemeral in-memory PostgreSQL; Next receives a dummy DB URL.
import assert from 'node:assert/strict';
import { mkdir, writeFile, unlink, rmdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { importFixture, item, handoff } from './helpers/featured-explanation-import-fixture.mjs';
import { service, load, http } from './helpers/official-explanation-fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const f=await importFixture(), dir=new URL('../app/explanation-import-test-fixture/',import.meta.url);
const artifacts=new URL('../.tmp/explanation-import-artifacts/',import.meta.url), base='http://localhost:3128';
let created=false,server,browser,page,log='';
try{
  await f.db.exec(await readFile(new URL('../migrations/20261014_question_proofreading.sql',import.meta.url),'utf8'));
  await f.db.exec(`UPDATE questions SET option_e='第五選項',answer='["C","E"]' WHERE id=60`);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=';
  await f.sql.query('UPDATE questions SET image_data_url=$1 WHERE id IN (60,61)',[png]);
  const exportRoute=load('app/api/admin/questions/explanation/export/route.ts',{'@/lib/admin':{requireAdmin:async()=>({sql:f.sql})},'@/lib/admin-question-http':http,'@/lib/explanation-handoff':handoff});
  await mkdir(dir);created=true;
  await writeFile(new URL('page.tsx',dir),"import Admin from '../admin/questions/QuestionsAdmin'; export default function Page(){return <Admin/>;}");
  server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','localhost','--port','3128'],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'postgresql://unused@127.0.0.1:1/never_connect',BETTER_AUTH_SECRET:'local-test-secret-at-least-32-characters',BETTER_AUTH_URL:base,NEXT_PUBLIC_SITE_URL:base},
  });
  server.stdout.on('data',chunk=>{log=(log+chunk).slice(-12000);});server.stderr.on('data',chunk=>{log=(log+chunk).slice(-12000);});
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/next.svg')).ok){ready=true;break;}}catch{} if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}
  assert(ready,log);
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  page=await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let writes=0;
  await page.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    const handler=path==='/api/admin/questions/explanation/export'?exportRoute:path==='/api/admin/questions/explanation/import'?f.batchRoute:path==='/api/admin/questions'?f.list:path==='/api/admin/questions/explanation'?f.route:null;
    if(handler){
      if(path.endsWith('/import')&&req.method()==='POST'&&req.postDataJSON().action==='import'){writes++;await new Promise(r=>setTimeout(r,200));}
      const response=await handler[req.method()](new Request(req.url(),{method:req.method(),headers:{...req.headers(),'x-fixture-user':'fixture-admin'},...(req.postData()?{body:req.postData()}: {})}));
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    if(path.startsWith('/api/auth/'))return route.fulfill({json:null});
    return route.fulfill({status:403,json:{error:'isolated fixture'}});
  });
  await page.goto(base+'/explanation-import-test-fixture');
  await page.getByText('匯出未解析國考題（ChatGPT 協作）',{exact:true}).click();
  const exportPanel=page.getByRole('region',{name:'未解析題目匯出'});
  await exportPanel.getByLabel('匯出題庫',{exact:true}).selectOption('1');await exportPanel.getByLabel('從此題目 ID 之後',{exact:true}).fill('59');
  await exportPanel.getByRole('button',{name:'讀取匯出預覽'}).click();await exportPanel.getByRole('status').filter({hasText:'共 10 題'}).waitFor();
  const downloadPromise=page.waitForEvent('download');await exportPanel.getByRole('button',{name:'下載題目交接 JSON'}).click();const downloaded=await downloadPromise;
  const exported=JSON.parse(await readFile(await downloaded.path(),'utf8'));assert.equal(exported.questions.length,10);assert.equal(exported.assets.length,1);assert.equal(writes,0);
  const imageDownload=page.waitForEvent('download');await exportPanel.getByRole('button',{name:/下載原圖/}).click();const downloadedImage=await imageDownload;
  assert.deepEqual(await readFile(await downloadedImage.path()),Buffer.from(png.split(',')[1],'base64'));
  await mkdir(artifacts,{recursive:true});
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if([375,1280].includes(width))await exportPanel.screenshot({path:fileURLToPath(new URL(`handoff-export-${width}.png`,artifacts))});}
  await page.locator('summary').filter({hasText:'批次匯入精選解析'}).click();
  const region=page.getByRole('region',{name:'批次匯入精選解析',exact:true});
  const file=region.getByLabel('精選解析 JSON 檔案');
  const upload=region.getByRole('button',{name:'上傳並驗證預覽'});
  const sample=JSON.parse(await readFile(new URL('../public/examples/explanation-handoff.example.json',import.meta.url),'utf8')).explanations[0];
  const structured={formatVersion:'vetexam-explanations-v1',explanations:exported.questions.map(q=>({...sample,questionId:q.questionId,questionFingerprint:q.questionFingerprint,sourceFingerprint:q.sourceFingerprint,expectedAnswers:q.officialAnswers,optionExplanations:Object.fromEntries(Object.entries(q.options).filter(([,v])=>v?.trim()).map(([k])=>[k,`選項 ${k} 獨立說明`])),references:[{...sample.references[0],supports:['correctAnswerReason']}],doubts:[],coreConcept:'**合成觀念**\n\n|重點|理由|\n|---|---|\n|C|中文 terminology|\n\n<script>window.__handoffXss=true</script>'}))};
  await file.setInputFiles({name:'handoff.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(structured))});await upload.click();
  await region.getByText('預覽共 10 筆，尚未寫入。預覽有效 15 分鐘。',{exact:true}).waitFor();
  assert.equal(await region.locator('article').count(),10);assert.equal(await region.getByRole('button',{name:/確認匯入並儲存/}).count(),1);assert(!await region.getByLabel('匯入第 1 筆',{exact:true}).isDisabled());
  await region.locator('article').first().getByText('解析預覽',{exact:true}).click();assert.equal(await region.locator('article').first().locator('table').count(),1);assert.equal(await page.evaluate(()=>window.__handoffXss),undefined);assert.equal(await region.locator('article').first().getByRole('heading',{name:'E',exact:true}).count(),1);
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await region.locator('article').first().screenshot({path:fileURLToPath(new URL('handoff-preview.png',artifacts))});assert.equal(writes,0);assert.equal((await service.readExplanation(f.sql.query,60)).status,'unwritten');
  await region.getByRole('button',{name:'勾選全部可匯入',exact:true}).click();await region.getByLabel(/我已核對勾選的題目/).check();
  await region.getByRole('button',{name:'確認匯入並儲存草稿（10 筆）',exact:true}).evaluate(button=>{button.click();button.click();});
  await region.getByText('匯入結果：成功 10 筆、失敗 0 筆、略過 0 筆。',{exact:true}).waitFor();assert.equal(writes,1);
  assert.equal((await service.readExplanation(f.sql.query,60)).status,'draft');assert.equal(await region.locator('a[href*="receiptId="]').count(),1);
  await file.setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{broken')});await upload.click();
  await region.getByRole('alert').filter({hasText:'JSON 格式錯誤'}).waitFor();
  const input={explanations:[...Array.from({length:20},(_,i)=>item(i+10)),item(2,{expectedAnswer:'B'}),item(999),item(40,{expectedAnswer:'A'})]};
  await file.setInputFiles({name:'explanations.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});await upload.click();
  await region.getByText('預覽共 23 筆，尚未寫入。預覽有效 15 分鐘。',{exact:true}).waitFor();assert.equal(writes,1);
  assert.equal((await service.readExplanation(f.sql.query,10)).status,'unwritten');
  assert(await region.getByLabel('匯入第 21 筆',{exact:true}).isDisabled());
  assert(await region.getByLabel('匯入第 22 筆',{exact:true}).isDisabled());
  const filter=region.getByLabel('解析匯入驗證分類');await filter.selectOption('existing');assert.equal(await region.locator('article').count(),1);await filter.selectOption('all');
  const first=region.locator('article').first();await first.locator('summary').filter({hasText:'解析預覽'}).click();
  assert.equal(await first.locator('table').count(),1);assert.equal(await first.locator('strong').last().innerText(),'中文');
  await mkdir(artifacts,{recursive:true});
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);if([375,1280].includes(width))await page.screenshot({path:fileURLToPath(new URL(`preview-${width}.png`,artifacts)),fullPage:false});}
  await region.getByLabel('匯入第 1 筆',{exact:true}).check();
  await region.getByRole('button',{name:'取消勾選',exact:true}).click();
  await region.getByRole('button',{name:'勾選全部可匯入',exact:true}).click();
  const apply=region.getByRole('button',{name:'確認匯入並儲存草稿（20 筆）',exact:true});assert(await apply.isDisabled());
  await region.getByLabel(/我已核對勾選的題目/).check();
  await apply.evaluate(button=>{button.click();button.click();});
  await region.getByText('匯入結果：成功 20 筆、失敗 0 筆、略過 3 筆。',{exact:true}).waitFor();assert.equal(writes,2);
  for(let id=10;id<30;id++)assert.equal((await service.readExplanation(f.sql.query,id)).status,'draft');
  await upload.click();await region.getByText('預覽共 23 筆，尚未寫入。預覽有效 15 分鐘。',{exact:true}).waitFor();
  assert(await region.getByLabel('匯入第 1 筆',{exact:true}).isDisabled());
  await page.reload();await page.getByRole('row').filter({has:page.locator('td:first-child').filter({hasText:/^#10(?:\s|第)/})}).getByRole('button',{name:'查看／編輯'}).click();
  const editor=page.getByLabel('精選解析內容',{exact:true});await editor.waitFor();
  await page.waitForFunction(()=>!document.querySelector('textarea[rows="16"]')?.disabled);
  assert.equal(await editor.inputValue(),input.explanations[0].explanation);
  const editPanel=page.getByRole('region',{name:'精選解析編輯'});
  await editPanel.getByLabel('我已人工核對解析及參考資料，確認與題庫答案一致。').check();await editPanel.getByRole('button',{name:'發布解析',exact:true}).click();
  await editPanel.getByText(/已人工確認並發布解析/).waitFor();assert.equal((await service.readExplanation(f.sql.query,10)).status,'published');
  await editPanel.getByRole('button',{name:'取消發布',exact:true}).click();await editPanel.getByText(/已取消發布，內容保留為草稿/).waitFor();
  await f.db.exec("UPDATE questions SET answer='A' WHERE id=10");await editPanel.getByRole('button',{name:'重新載入解析',exact:true}).click();
  const recheck=editPanel.getByLabel('我已重新核對最新題目與來源，確認本解析適用於目前版本。');await recheck.waitFor();assert(await editPanel.getByRole('button',{name:'發布解析',exact:true}).isDisabled());
  await recheck.check();await editPanel.getByRole('button',{name:'儲存草稿',exact:true}).click();await editPanel.getByText(/草稿已儲存，考生無法閱讀/).waitFor();assert.equal((await service.readExplanation(f.sql.query,10)).sourceChanged,false);
  for(const width of [375,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await editPanel.screenshot({path:fileURLToPath(new URL(`handoff-review-${width}.png`,artifacts))});}
  assert.deepEqual(errors,[]);
  console.log('PASS: real admin UI file parse/preview/categories/selection/Markdown/20 drafts/double-click/replay/reload; 320/375/768/1280 responsive; no browser errors');
}catch(error){if(page)console.error((await page.locator('body').innerText()).slice(-4000));console.error(log);throw error;}
finally{
  await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await f.close();
  if(created){await unlink(new URL('page.tsx',dir));await rmdir(dir);}
  for(const path of ['../.next/dev/types/validator.ts','../.next/dev/types/routes.d.ts']){const url=new URL(path,import.meta.url);if((await readFile(url,'utf8').catch(()=>'' )).includes('explanation-import-test-fixture'))await unlink(url);}
}
