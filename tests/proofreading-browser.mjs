import assert from 'node:assert/strict';
import {mkdir,writeFile,unlink,rmdir,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fixture,png,payload} from './helpers/proofreading-fixture.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),f=await fixture(80);
const dir=new URL('../app/proofreading-test-fixture/',import.meta.url),base='http://127.0.0.1:3131',artifacts=new URL('../.tmp/proofreading-browser/',import.meta.url);
let server,browser,page,created=false,log='';
try{
 await f.query("UPDATE questions SET option_e='系統誤產生的第五選項' WHERE id=1");
 await f.save(payload(await f.detail(2),{images:[{dataUrl:png('red')},{dataUrl:png('blue')}]}));
 await mkdir(dir);created=true;await mkdir(artifacts,{recursive:true});await writeFile(new URL('page.tsx',dir),`import Proofreading from '../admin/questions/proofread/Proofreading';export default Proofreading;`);
 server=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3131'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,DATABASE_URL:'postgresql://unused@127.0.0.1:1/never_connect',BETTER_AUTH_SECRET:'isolated-local-test-secret-at-least-32-characters',BETTER_AUTH_URL:base}});
 server.stdout.on('data',c=>log=(log+c).slice(-12000));server.stderr.on('data',c=>log=(log+c).slice(-12000));
 let ready=false;for(let n=0;n<100;n++){try{if((await fetch(base+'/next.svg')).ok){ready=true;break;}}catch{}if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,500));}assert(ready,log);
 browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1280,height:950}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const r=route.request();if(new URL(r.url()).pathname==='/api/admin/questions/proofread'){
   const response=await f.route[r.method()](new Request(r.url(),{method:r.method(),headers:{...r.headers(),'x-test-user':'admin'},...(r.postData()?{body:r.postData()}: {})}));
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }if(r.url().includes('/api/auth/')){await new Promise(r=>setTimeout(r,200));return route.fulfill({json:null});}return route.fulfill({status:401,json:{error:'isolated fixture'}});
 });
 await page.goto(base+'/proofreading-test-fixture');await page.getByLabel('考卷',{exact:true}).selectOption('1');const editor=page.getByRole('region',{name:'題目完整編輯'});await editor.waitFor();
 await editor.getByRole('button',{name:'刪除 E',exact:true}).click();assert.equal(await editor.getByRole('checkbox',{name:'A',exact:true}).isChecked(),false);
 await editor.getByRole('checkbox',{name:'A',exact:true}).check();await editor.getByRole('checkbox',{name:'B',exact:true}).check();await editor.getByLabel('題幹',{exact:true}).fill('修正後的完整題幹：H₂O、Na⁺、β-blocker。\n'+('長篇醫學英文術語及中文換行。'.repeat(60)));
 await editor.getByRole('button',{name:'預覽題目',exact:true}).click();assert((await editor.getByLabel('題目預覽').innerText()).includes('官方答案：A、B'));await editor.getByRole('button',{name:'返回編輯',exact:true}).click();
 await editor.getByLabel('我已重新確認選項代號及所有官方接受答案').check();await editor.getByRole('button',{name:'儲存',exact:true}).click();await page.getByRole('status').filter({hasText:'已儲存'}).waitFor();assert.equal((await f.detail(1)).options.length,4);assert.equal((await f.detail(1)).answer,'["A","B"]');
 await editor.getByLabel('題幹',{exact:true}).fill('未儲存的題幹修改內容。');page.once('dialog',d=>d.dismiss());await editor.getByRole('button',{name:'下一題',exact:true}).click();assert((await editor.innerText()).includes('ID 1'));
 page.once('dialog',d=>d.accept());await editor.getByRole('button',{name:'下一題',exact:true}).click();await editor.getByRole('heading',{name:'第 2 題 · ID 2'}).waitFor();
 const firstImage=editor.getByRole('button',{name:'放大查看：第 2 題圖片 1',exact:true});await firstImage.click();await page.getByRole('dialog').filter({has:page.getByRole('button',{name:'關閉圖片 ×'})}).filter({visible:true}).waitFor().catch(()=>{});await page.getByRole('button',{name:'關閉圖片 ×'}).filter({visible:true}).click();
 await editor.getByRole('button',{name:'上移圖片 2',exact:true}).click();await editor.getByRole('button',{name:'儲存',exact:true}).click();await page.getByRole('status').filter({hasText:'已儲存'}).waitFor();
 assert.equal(await (await import('./helpers/proofreading-fixture.mjs')).service.proofImage(f.query,2,0,(await f.detail(2)).revision),png('blue'));
 await editor.getByRole('button',{name:'移除圖片 1',exact:true}).click();await editor.getByRole('button',{name:'儲存',exact:true}).click();await page.getByRole('status').filter({hasText:'已儲存'}).waitFor();assert.equal((await f.detail(2)).imageCount,1);
 await editor.getByRole('button',{name:'标記已核對'.replace('标','標'),exact:true}).click();await page.getByRole('status').filter({hasText:'已記錄人工核對'}).waitFor();
 await page.getByRole('button',{name:'返回整份考卷',exact:true}).click();const paper=page.getByRole('region',{name:'整卷校對模式'});await paper.waitFor();assert.equal(await paper.locator('article').count(),80);assert((await paper.locator('article').first().innerText()).includes('H₂O'));
 await paper.getByRole('button',{name:'編輯題目 80',exact:true}).click();await editor.getByRole('heading',{name:/第 80 題/}).waitFor();assert(await editor.getByRole('button',{name:'下一題',exact:true}).isDisabled());
 await editor.getByText('題目圖片（0 張）',{exact:true}).click();await editor.getByLabel('新增圖片',{exact:true}).setInputFiles([{name:'red.png',mimeType:'image/png',buffer:Buffer.from(png('red').split(',')[1],'base64')},{name:'blue.png',mimeType:'image/png',buffer:Buffer.from(png('blue').split(',')[1],'base64')}]);
 await editor.getByRole('button',{name:'移除圖片 2',exact:true}).waitFor();await editor.getByRole('button',{name:'儲存',exact:true}).click();await page.getByRole('status').filter({hasText:'已儲存'}).waitFor();
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+width);await page.screenshot({path:fileURLToPath(new URL('editor-'+width+'.png',artifacts)),fullPage:true});}
 await page.getByRole('button',{name:'返回整份考卷',exact:true}).click();await paper.waitFor();await page.getByLabel('篩選',{exact:true}).selectOption('reviewed');assert.equal(await paper.locator('article').count(),1);await page.getByLabel('篩選',{exact:true}).selectOption('all');await page.getByLabel('題號搜尋').fill('80');assert.equal(await paper.locator('article').count(),1);
 assert.deepEqual(errors,[]);assert.equal((await f.query('SELECT count(*)::int n FROM questions'))[0].n,81);console.log('PASS browser: full 80-question overview, delete E, A/B answers, stem+Markdown preview, image zoom/order/remove/upload, save/reload, dirty navigation guard, review filters, jump to 80, mobile/tablet/desktop');
}catch(e){if(page)console.error((await page.locator('body').innerText()).slice(-4000));console.error(log.slice(-5000));throw e;}
finally{await browser?.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await f.close();if(created){await unlink(new URL('page.tsx',dir));await rmdir(dir);}for(const p of ['../.next/dev/types/validator.ts','../.next/dev/types/routes.d.ts']){const url=new URL(p,import.meta.url);if((await readFile(url,'utf8').catch(()=>'' )).includes('proofreading-test-fixture'))await unlink(url);}}
