// Read-only real public-bank checks. Answers are submitted as guests (no stats writes).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink, rmdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';
import pg from 'pg';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
nextEnv.loadEnvConfig(process.cwd());
const base = 'http://localhost:3112';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
let server, browser, created=false;
const fixtureDirectory = new URL('../app/question-detail-ui-fixture/', import.meta.url);
const fixturePage = new URL('page.tsx', fixtureDirectory);
try {
  await client.connect();
  const columns = (await client.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('questions','question_sets') ORDER BY table_name,ordinal_position")).rows;
  console.log('Schema inspected:', columns.map(row => `${row.table_name}.${row.column_name}:${row.data_type}`).join(', '));
  const indexes = (await client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('questions','question_sets')")).rows;
  console.log('Existing question indexes:', JSON.stringify(indexes));
  const { rows } = await client.query(`SELECT q.id,q.answer,q.explanation FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
    WHERE qs.visibility='public' ORDER BY q.id LIMIT 1`);
  assert(rows[0], 'A public question is required');
  const question = rows[0];
  const privateId = (await client.query("SELECT q.id FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id WHERE qs.visibility='private' LIMIT 1")).rows[0]?.id;
  const missingId = (await client.query("SELECT q.id FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id WHERE qs.visibility='public' AND NULLIF(BTRIM(q.answer),'') IS NULL LIMIT 1")).rows[0]?.id;
  await mkdir(fixtureDirectory);created=true;
  await writeFile(fixturePage, `import QuestionDetail from '../questions/[id]/QuestionDetail';
    export default function Page(){return <QuestionDetail question={{id:123,questionSetId:1,questionNumber:37,subject:'獸醫病理學',examYear:2026,question:'腎上腺測試題目：請選出正確選項。',options:['a','b','c','d'],hasAnswer:true}} shareUrl="https://vetexam.example/questions/123"/>}`);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3112'], { windowsHide:true, stdio:['ignore','pipe','pipe'], env: { ...process.env, NEXT_PUBLIC_SITE_URL: 'https://vetexam.example' } });
  let logs=''; server.stdout.on('data',data=>{logs=(logs+data).slice(-4000);}); server.stderr.on('data',data=>{logs=(logs+data).slice(-4000);});
  let ready=false;
  for(let i=0;i<60;i++) { try { if((await fetch(base+'/questions/search')).ok){ready=true;break;} }catch{} if(server.exitCode!==null)throw Error(logs); await new Promise(resolve=>setTimeout(resolve,500)); }
  assert(ready,logs);
  for(const id of ['not-an-id','2147483647',...(privateId?[String(privateId)]:[])]) {
    const response=await fetch(base+'/questions/'+id, { headers:{'User-Agent':'Googlebot'} });
    assert.equal(response.status,404,`404 for ${id}`);
  }
  const initial = await (await fetch(base+'/questions/'+question.id)).text();
  assert(!initial.includes('\\"answer\\":'), 'RSC must not contain answer prop');
  assert(!initial.includes('\\"explanation\\":'), 'RSC must not contain explanation prop');
  if(question.explanation?.length>20) assert(!initial.includes(question.explanation),'Explanation absent from HTML');
  browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(); const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.log('Browser error:',error.message);});
  page.on('console',message=>{if(message.type()==='error')console.log('Browser console:',message.text());});
  await page.goto(base+'/questions/search');
  assert.equal(await page.getByRole('link',{name:'查看題目',exact:true}).count(),0);
  for(const keyword of ['Addison','腎上腺']) {
    const expected=Number((await client.query("SELECT COUNT(*) AS n FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id WHERE qs.visibility='public' AND (q.question ILIKE $1 OR q.option_a ILIKE $1 OR q.option_b ILIKE $1 OR q.option_c ILIKE $1 OR q.option_d ILIKE $1)",['%'+keyword+'%'])).rows[0].n);
    await page.getByLabel('關鍵字').fill(keyword);await page.getByRole('button',{name:'搜尋題目',exact:true}).click();
    await page.waitForURL(url=>url.searchParams.get('q')===keyword);
    if(expected)await page.getByRole('link',{name:'查看題目',exact:true}).first().waitFor();else await page.getByText(/找不到符合條件的題目/).waitFor();
    assert(await page.getByRole('link',{name:'查看題目',exact:true}).count()<=20);
    console.log('Real bank search passed:',keyword,'matches:',expected);
  }
  await page.getByLabel('關鍵字').fill(''); await page.getByLabel('國考年份').fill('115');
  await page.getByLabel('科目',{exact:true}).selectOption('獸醫病理學');await page.getByRole('button',{name:'搜尋題目',exact:true}).click();
  await page.waitForURL(url=>url.searchParams.get('year')==='115');
  await page.locator('section[aria-label="搜尋結果"]').waitFor();
  for(const text of await page.locator('article h2').allTextContents()) assert(text.includes('115')&&text.includes('獸醫病理學'));
  const artifacts=process.env.TEST_ARTIFACT_DIR||'.tmp/search-artifacts';await mkdir(artifacts,{recursive:true});
  for(const width of [320,375,768,1280]) { await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`search ${width}`);if(width===375)await page.screenshot({path:`${artifacts}/search-375.png`,fullPage:true}); }
  const next=page.getByRole('link',{name:'下一頁',exact:true});if(await next.count()){await next.click();await page.waitForURL(url=>url.searchParams.get('page')==='2');await page.goBack();await page.waitForURL(url=>!url.searchParams.has('page'));}
  await page.goto(base+'/questions/'+question.id);
  assert.equal(await page.getByRole('heading',{name:'VetExam 官方解析'}).count(),0);
  assert.equal(await page.getByText('大家都選了什麼？',{exact:false}).count(),0);
  // The real bank currently has no usable answers; isolate the answer UI fixture.
  await page.route('**/api/stats/answers?reveal=1',route=>route.fulfill({json:{available:true,answer:'C',correct:false,explanation:'測試官方解析：'+ 'long-reference-text'.repeat(35)}}));
  await page.route('**/api/stats/option-distribution?**',route=>route.fulfill({json:{total:0,sufficient:false,min_attempts:5,options:[]}}));
  await page.goto(base+'/question-detail-ui-fixture');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='複製題目連結' && Object.keys(button).some(key=>key.startsWith('__reactProps') && typeof button[key]?.onClick==='function')));
  await page.getByRole('button',{name:'複製題目連結',exact:true}).click();
  await page.getByText(/已複製題目連結|無法自動複製/).waitFor();
  if(await page.getByText('已複製題目連結',{exact:true}).count()) assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),'https://vetexam.example/questions/123');
  else {await page.getByText('https://vetexam.example/questions/123',{exact:true}).waitFor();console.log('Native clipboard restricted: manual-copy fallback verified.');}
  await page.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.__copiedQuestionLink=text;}}));
  await page.getByRole('button',{name:'複製題目連結',exact:true}).click();await page.getByText('已複製題目連結',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__copiedQuestionLink),'https://vetexam.example/questions/123');
  await page.getByRole('group',{name:'答案選項',exact:true}).getByRole('button').first().click();
  await page.getByRole('heading',{name:'VetExam 官方解析'}).waitFor();
  await page.getByRole('status').filter({hasText:'你的答案：A'}).waitFor();
  for(const width of [320,375,768,1280]) {await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`detail ${width}`);if(width===375)await page.screenshot({path:`${artifacts}/detail-375.png`,fullPage:true});}
  if(missingId){await page.goto(base+'/questions/'+missingId);await page.getByText('本題正確答案目前正在整理中。',{exact:false}).waitFor();assert(await page.getByRole('group',{name:'答案選項'}).getByRole('button').first().isDisabled());}
  await page.goto(base+'/questions/search?q=zzzz_no_matching_question');await page.getByText(/找不到符合條件的題目/).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS real searches/filters, pagination/back, missing answer, HTML redaction, 404/private; fixture answer UI, clipboard, widths 320/375/768/1280; no browser errors.');
} finally {
  if(browser)await browser.close();if(server)server.kill();await client.end();
  if(created){await unlink(fixturePage).catch(()=>{});await rmdir(fixtureDirectory).catch(()=>{});}
  for(const name of ['validator.ts','routes.d.ts']){const generated=new URL('../.next/dev/types/'+name,import.meta.url);if((await readFile(generated,'utf8').catch(()=>'')).includes('question-detail-ui-fixture'))await unlink(generated).catch(()=>{});}
}
