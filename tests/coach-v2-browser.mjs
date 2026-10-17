import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
import {fixture} from './helpers/coach-v2-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),f=await fixture(),base='http://127.0.0.1:3143';
let server,browser,log='',owner='b',dropReply=false;const errors=[];
try{
 await f.seed('a');await mkdir('.tmp/coach-v2-browser',{recursive:true});
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3143'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'postgresql://unused@127.0.0.1:1/never_connect',BETTER_AUTH_SECRET:'isolated-local-secret-at-least-32-characters',BETTER_AUTH_URL:base}});
 server.stdout.on('data',c=>log=(log+c).slice(-15000));server.stderr.on('data',c=>log=(log+c).slice(-15000));
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(base+'/next.svg')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}assert(ready,log);
 browser=await chromium.launch({channel:'msedge',headless:true});
 async function pageFor(){const context=await browser.newContext({viewport:{width:375,height:900}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{const request=route.request(),path=new URL(request.url()).pathname;
   const handlers=path==='/api/study-plan/daily'?f.route:path==='/api/study-plan/diagnostic'?f.diagnosticRoute:null;
   if(handlers){const r=await handlers[request.method()](new Request(request.url(),{method:request.method(),headers:{...request.headers(),'x-test-user':owner},...(request.postData()?{body:request.postData()}:{})}));
    if(dropReply&&request.method()==='PUT'){dropReply=false;return route.fulfill({status:503,json:{error:'測試：回應中斷，請重試。'}});}
    return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});}
   if(path==='/api/study-plan')return route.fulfill({json:{mode:'coach'}});
   if(path.startsWith('/api/auth/'))return route.fulfill({json:null});return route.fulfill({status:401,json:{error:'isolated fixture'}});
  });return page;
 }
 const page=await pageFor();await page.goto(base+'/study-plan');await page.getByRole('link',{name:'開始初始能力診斷',exact:true}).click();
 await page.getByRole('button',{name:'開始診斷',exact:true}).click();await page.getByRole('group',{name:'診斷答案選項'}).getByRole('button').first().click();await page.getByRole('button',{name:'送出並繼續',exact:true}).click();await page.getByText('已儲存 1 / 60 題',{exact:true}).waitFor();
 await page.goto(base+'/study-plan');await page.getByRole('link',{name:'繼續初始能力診斷',exact:true}).waitFor();
 owner='a';await page.reload();await page.getByRole('link',{name:'開始弱點特訓',exact:true}).waitFor();
 await page.getByText('每日目標與設定',{exact:true}).click();await page.getByLabel('每日目標（5～60 題）',{exact:true}).fill('25');await page.getByRole('button',{name:'儲存每日目標',exact:true}).click();await page.getByText('每日目標已儲存；',{exact:false}).waitFor();assert.equal((await f.read('a')).target,25);assert.equal((await f.read('a')).task.total,20);await page.getByText('每日目標與設定',{exact:true}).click();
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'home overflow '+width);await page.screenshot({path:'.tmp/coach-v2-browser/home-'+width+'.png',fullPage:true});}
 await page.getByRole('link',{name:'開始綜合挑戰',exact:true}).click();await page.getByRole('group',{name:'每日任務答案選項'}).waitFor();assert.equal(await page.getByText('官方答案：',{exact:false}).count(),0);
 async function answer(p,wrong=false){await p.getByRole('group',{name:'每日任務答案選項'}).getByRole('button').nth(wrong?1:0).click();await p.getByRole('button',{name:/^送出並/}).click();}
 await answer(page);await page.getByText('今日已儲存 1 / 20 題',{exact:true}).waitFor();
 dropReply=true;await answer(page,true);await page.getByText('測試：回應中斷，請重試。',{exact:true}).waitFor();assert.equal((await f.read('a')).task.answered,2);await page.getByRole('button',{name:/^送出並/}).click();await page.getByText('今日已儲存 2 / 20 題',{exact:true}).waitFor();
 await page.reload();await page.getByText('今日已儲存 2 / 20 題',{exact:true}).waitFor();
 const other=await pageFor();await other.goto(base+'/study-plan/daily?task=weakness');await other.getByRole('group',{name:'每日任務答案選項'}).waitFor();await answer(other);await other.getByText('今日已儲存 3 / 20 題',{exact:true}).waitFor();await other.close();
 await page.reload();await page.getByText('今日已儲存 3 / 20 題',{exact:true}).waitFor();
 for(const key of ['weakness','review','challenge']){await page.goto(base+'/study-plan/daily?task='+key);await page.getByText('今日已儲存',{exact:false}).waitFor();
  while((await f.read('a')).coach.groups.find(g=>g.key===key).current){const before=(await f.read('a')).task.answered;await answer(page);await page.getByText(`今日已儲存 ${before+1} / 20 題`,{exact:true}).waitFor();}
  await page.getByText('本次答案與已發布解析',{exact:true}).click();await page.getByText('官方答案：',{exact:false}).first().waitFor();
 }
 await page.getByRole('heading',{name:'今日成果與明日方向',exact:true}).waitFor();await page.reload();await page.getByText('今日已儲存 20 / 20 題',{exact:true}).waitFor();
 await page.goto(base+'/study-plan');for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});await page.getByRole('heading',{name:'今天的訓練完成了',exact:true}).waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'feedback overflow '+width);}
 await page.screenshot({path:'.tmp/coach-v2-browser/complete.png',fullPage:true});
 assert.equal((await f.query("SELECT count(*)::int n FROM question_answer_stats WHERE user_id='a'"))[0].n,20);assert.deepEqual(errors,[]);
 console.log('PASS actual Next UI + isolated real API/PostgreSQL: initial diagnostic, three tasks, resume, two devices, ambiguous retry, completion feedback, 375/768/1280');
}catch(e){await writeFile('.tmp/coach-v2-browser/server.log',log).catch(()=>{});throw e;}finally{await browser?.close();if(server){server.kill();await new Promise(r=>{if(server.exitCode!==null)return r();server.once('exit',r);setTimeout(r,5000);});}await f.close();}
