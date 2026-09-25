import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.TEST_BASE_URL||'http://localhost:3242';
const browser=await chromium.launch({channel:'msedge',headless:true});
mkdirSync('.tmp/review-artifacts',{recursive:true});
const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="600" height="120" fill="#def"/><text x="20" y="65">Question image</text></svg>');
const question={id:1,questionSetId:1,questionNumber:1,subject:'獸醫病理學',question:'圖片中的變化最符合下列何者？',options:['甲','乙','丙','丁','戊'],answer:'E',explanation:'這是既有解析。',imageDataUrl:image,examYear:115,questionSetName:'fixture'};
try {
  for(const width of [320,375,768,1280]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    let owner='alice', due=true, fail=false, reads=0, attempts=0;
    const events=new Set(), delivered=[];
    const snapshot={owner,progress:{},history:[],favorites:[],wrongQuestions:[],legacy:[]};
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      let json={};
      if(path==='/api/auth/get-session')json=owner?{user:{id:owner,name:'Fixture',email:'fixture@example.test',emailVerified:true},session:{id:'fixture',userId:owner,expiresAt:new Date(Date.now()+86400000).toISOString()}}:null;
      else if(path==='/api/review/due') {reads++;json={owner,asOf:new Date().toISOString(),dueNow:due?1:0,dueToday:due?1:0,upcoming7Days:3,queue:due?[question]:[]};}
      else if(path==='/api/learning') {
        if(route.request().method()==='GET')json={...snapshot,owner};
        else {
          const body=route.request().postDataJSON();assert.equal(body.owner,owner);
          if(body.action==='answers') {
            assert.equal(body.mode,'practice');delivered.push(body.answers[0].event_id);
            if(fail)return route.fulfill({status:503,json:{error:'offline'}});
            for(const answer of body.answers)if(!events.has(answer.event_id)){events.add(answer.event_id);attempts++;due=false;snapshot.wrongQuestions=answer.selected_answer==='E'?[]:[{...question,userAnswer:answer.selected_answer}];}
          }
          if(body.action==='review'&&body.field==='favorite')snapshot.favorites=body.value?[question]:[];
          json={success:true};
        }
      } else if(path==='/api/admin/status')json={isAdmin:false};
      return route.fulfill({json});
    });
    await page.goto(base+'/review');
    await page.getByRole('button',{name:'開始到期複習',exact:true}).click();
    await page.getByRole('heading',{name:question.question}).waitFor();
    await page.getByRole('img',{name:'第 1 題圖片'}).waitFor();
    assert(await page.getByRole('img',{name:'第 1 題圖片'}).evaluate(img=>img.complete&&img.naturalWidth>0));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'question overflow '+width);
    await page.getByRole('button',{name:'收藏題目',exact:true}).click();
    await page.getByRole('button',{name:'已收藏',exact:true}).waitFor();
    fail=true;
    await page.getByRole('button',{name:'A 甲',exact:true}).click();
    await page.locator('main').getByRole('alert').waitFor();assert.equal(attempts,0);assert.equal(due,true);
    assert.equal(await page.getByText('這是既有解析。',{exact:true}).count(),0);
    fail=false;
    await page.getByRole('button',{name:'重試',exact:true}).click();
    await page.getByText('這是既有解析。',{exact:true}).waitFor();
    assert.equal(attempts,1);assert.equal(new Set(delivered).size,1,'retry uses original event');assert.equal(snapshot.wrongQuestions.length,1);
    assert.equal(snapshot.favorites.length,1);assert(reads>=3,'refresh server queue after commit');
    await page.getByRole('button',{name:'E 戊 ✓ 正確答案',exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'answer overflow '+width);
    await page.screenshot({path:`.tmp/review-artifacts/review-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'完成複習',exact:true}).click();
    await page.getByText('今天沒有需要複習的題目',{exact:true}).waitFor();
    assert.equal(attempts,1);assert.equal(await page.getByRole('heading',{name:question.question}).count(),0);
    await page.reload();await page.getByText('今天沒有需要複習的題目',{exact:true}).waitFor();
    assert.equal(attempts,1);
    due=true;await page.getByRole('button',{name:'重新整理',exact:true}).click();
    await page.getByRole('button',{name:'E 戊',exact:true}).click();
    await page.getByText('✓ 答對了，正確答案：E',{exact:true}).waitFor();assert.equal(attempts,2);
    owner=null;await page.reload();await page.getByRole('link',{name:'登入後查看到期複習',exact:true}).waitFor();
    assert.equal(await page.getByRole('heading',{name:question.question}).count(),0);
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS due review: four widths, image, A–E, favorite, wrong/correct, failed save, stable event retry, server refresh, completion, reload, guest');
} finally { await browser.close(); }
