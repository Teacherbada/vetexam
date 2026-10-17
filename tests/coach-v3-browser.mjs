import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {fixture,taxonomy} from './helpers/coach-v2-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),f=await fixture(),base='http://127.0.0.1:3144';
let server,browser,log='',reportCalls=0;const errors=[];
try{
 await f.seed('a');await mkdir('.tmp/coach-v3-browser',{recursive:true});
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3144'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'postgresql://unused@127.0.0.1:1/never_connect',BETTER_AUTH_SECRET:'isolated-local-secret-at-least-32-characters',BETTER_AUTH_URL:base}});
 server.stdout.on('data',c=>log=(log+c).slice(-20000));server.stderr.on('data',c=>log=(log+c).slice(-20000));
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(base+'/next.svg')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}assert(ready,log);
 browser=await chromium.launch({channel:'msedge',headless:true});
 async function pageFor(){const context=await browser.newContext({viewport:{width:375,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;
   const handlers=path==='/api/study-plan/daily'?f.route:path==='/api/study-plan/coach'?f.coachRoute:null;
   if(handlers){if(path==='/api/study-plan/coach'&&request.method()==='GET')reportCalls++;
    const response=await handlers[request.method()](new Request(request.url(),{method:request.method(),headers:{...request.headers(),'x-test-user':'a'},...(request.postData()?{body:request.postData()}:{})}));
    return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
   if(path==='/api/study-plan')return route.fulfill({json:{mode:'coach'}});
   if(path.startsWith('/api/auth/'))return route.fulfill({json:null});return route.fulfill({status:401,json:{error:'isolated fixture'}});
  });return page;
 }
 const page=await pageFor();await page.goto(base+'/study-plan');await page.getByRole('link',{name:'開始弱點特訓',exact:true}).waitFor();assert.equal(reportCalls,0,'report stays lazy');
 await page.getByText('本週重點與學習週報',{exact:true}).click();await page.getByLabel('本週想優先加強的科目').selectOption(taxonomy.EXAM_SUBJECTS[3]);await page.getByRole('button',{name:'儲存本週重點',exact:true}).click();await page.getByText('本週偏好已儲存。',{exact:false}).waitFor();
 await page.getByText('目前沒有足夠的可比樣本，暫不判定進步。',{exact:false}).waitFor();
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'preferences overflow '+width);await page.screenshot({path:'.tmp/coach-v3-browser/report-'+width+'.png',fullPage:true});}
 await page.setViewportSize({width:375,height:900});await page.getByRole('button',{name:'今天很忙（約 5 題）',exact:true}).click();await page.getByText('精簡進度 0 / 5 題；',{exact:false}).waitFor();
 await page.getByRole('link',{name:'開始或繼續精簡訓練',exact:true}).click();
 assert.equal(await page.getByText('官方答案：',{exact:false}).count(),0);
 const original=(await f.read('a')).task.id;
 async function answer(p,wrong=false){await p.getByRole('group',{name:'每日任務答案選項'}).getByRole('button').nth(wrong?1:0).click();await p.getByRole('button',{name:/^送出並/}).click();}
 await answer(page,true);await page.getByText('精簡進度 1 / 5 題；',{exact:false}).waitFor();
 await page.reload();await page.getByText('精簡進度 1 / 5 題；',{exact:false}).waitFor();
 const second=await pageFor();await second.goto(base+'/study-plan');await second.getByText('精簡進度 1 / 5 題；',{exact:false}).waitFor();await second.getByText('本週重點與學習週報',{exact:true}).click();assert.equal(await second.getByLabel('本週想優先加強的科目').inputValue(),taxonomy.EXAM_SUBJECTS[3]);
 await second.getByRole('link',{name:'開始或繼續精簡訓練',exact:true}).click();await answer(second);await second.getByText('精簡進度 2 / 5 題；',{exact:false}).waitFor();await second.close();
 await page.reload();await page.getByText('精簡進度 2 / 5 題；',{exact:false}).waitFor();
 for(let n=3;n<=5;n++){await answer(page);await page.getByText(`精簡進度 ${n} / 5 題；`,{exact:false}).waitFor();}
 await page.getByRole('heading',{name:'今日精簡訓練完成',exact:true}).first().waitFor();assert(!(await f.read('a')).task.completed);assert.equal((await f.read('a')).target,20);
 await page.screenshot({path:'.tmp/coach-v3-browser/busy-complete.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('button',{name:'正常練習',exact:true}).click();await page.getByRole('group',{name:'每日任務答案選項'}).waitFor();await answer(page);await page.getByText('今日已儲存 6 / 20 題',{exact:true}).waitFor();
 await page.goto(base+'/study-plan');await page.getByText('本週重點與學習週報',{exact:true}).click();await page.getByText('完成 6 題，答對 5 題；完成訓練 1 天',{exact:false}).waitFor();
 assert.equal((await f.read('a')).task.id,original);assert.deepEqual(errors,[]);
 console.log('PASS Phase 3 actual Next UI + real isolated APIs: lazy report, weekly focus, busy/full preservation, wrong-answer schedule, two devices, reload, 375/768/1280');
}catch(e){await writeFile('.tmp/coach-v3-browser/server.log',log).catch(()=>{});throw e;}finally{await browser?.close();if(server){server.kill();await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r);setTimeout(r,5000);});}await f.close();}
