import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const base=process.env.TEST_BASE_URL||'http://localhost:3139';
mkdirSync('.tmp/daily-task-artifacts',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let state={mode:'coach',owner:'daily-fixture',date:'2026-09-14',target:30,task:{id:'12345678-1234-1234-1234-123456789012',target:30,total:30,answered:0,completed:false,correct:null,current:{position:1,question:'每日測試題目',options:['選項一','選項二'],image:null},summary:[],followUpsCompleted:0},receipts:[],active:{subject:'獸醫病理學',chapter:'細胞與組織的變性及死亡',status:'reviewing'},next:'reinforcement'};
  let fail=false;
  await page.route('**/api/study-plan/daily',async route=>{
    if(fail)return route.fulfill({status:503,json:{error:'測試連線失敗，請重試。'}});
    const method=route.request().method();
    if(method==='PATCH')state.target=route.request().postDataJSON().target;
    if(method==='PUT') {
      const request=route.request().postDataJSON();assert.equal(request.position,state.task.current.position);
      const position=state.task.current.position;
      state.receipts.push({eventId:'daily-session:'+position,id:position,subject:'獸醫病理學',question:'每日測試題目 '+position,options:['選項一','選項二'],answer:'A',explanation:'測試解析',userAnswer:request.answer,correct:request.answer==='A'});
      state.task.answered++;
      if(state.task.answered===state.task.total) {state.task.completed=true;state.task.current=null;state.task.correct=state.receipts.filter(r=>r.correct).length;state.task.followUpsCompleted=1;state.task.summary=[{source:'normal',total:20,correct:19},{source:'weakness',total:8,correct:8},{source:'follow_up',total:2,correct:2}];}
      else state.task.current.position++;
    }
    return route.fulfill({json:state});
  });
  await page.route('**/api/study-plan',r=>r.fulfill({json:{mode:'coach'}}));
  await page.route('**/api/study-plan/diagnostic',r=>r.fulfill({json:{mode:'coach',session:null}}));
  await page.route('**/api/study-plan/reinforcement',r=>r.fulfill({json:{mode:'coach',task:null,next:null,session:null,attempts:[],completed:[],due:[]}}));
  await page.goto(base+'/study-plan');await page.getByRole('link',{name:'開始今日任務',exact:true}).waitFor();
  await page.getByRole('link',{name:'繼續補強任務',exact:true}).waitFor();
  await page.getByText('每日目標題數',{exact:true}).click();await page.getByLabel('每日目標（5～60 題）',{exact:true}).fill('40');await page.getByRole('button',{name:'儲存每日目標',exact:true}).click();
  await page.getByText('每日目標已儲存；',{exact:false}).waitFor();assert.equal(state.task.total,30);
  await page.getByRole('link',{name:'開始今日任務',exact:true}).click();
  await page.getByRole('group',{name:'每日任務答案選項',exact:true}).waitFor();
  assert.equal(await page.getByText('第 1 題',{exact:true}).count(),1);
  assert.equal(await page.getByRole('heading',{name:'目前補強任務',exact:true}).count(),0,'quiz does not reveal active weakness chapter');
  for(const width of [320,375,768,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'quiz overflow '+width);}
  await page.setViewportSize({width:375,height:900});await page.screenshot({path:'.tmp/daily-task-artifacts/mobile-quiz.png',fullPage:true});
  for(let position=1;position<=12;position++) {
    await page.getByRole('button',{name:position===1?'B 選項二':'A 選項一',exact:true}).click();await page.getByRole('button',{name:'送出並繼續',exact:true}).click();await page.getByText(`${position} / 30 題`,{exact:true}).waitFor();
  }
  await page.reload();await page.getByText('12 / 30 題',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('wrongQuestions')).length),1);
  assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('dailyProgress')))[0].completed),12);
  fail=true;await page.getByRole('button',{name:'A 選項一',exact:true}).click();await page.getByRole('button',{name:'送出並繼續',exact:true}).click();await page.getByText('測試連線失敗，請重試。',{exact:true}).waitFor();assert.equal(state.task.answered,12);
  fail=false;await page.getByRole('button',{name:'送出並繼續',exact:true}).click();await page.getByText('13 / 30 題',{exact:true}).waitFor();
  for(let position=14;position<=30;position++){await page.getByRole('button',{name:'A 選項一',exact:true}).click();await page.getByRole('button',{name:position===30?'送出並完成今日任務':'送出並繼續',exact:true}).click();await page.getByText(`${position} / 30 題`,{exact:true}).waitFor();}
  await page.getByRole('heading',{name:'今日任務完成',exact:true}).waitFor();await page.getByText('已完成 1 項複習追蹤。',{exact:true}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'今日任務完成',exact:true}).waitFor();assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('dailyProgress')))[0].completed),30);
  await page.screenshot({path:'.tmp/daily-task-artifacts/mobile-complete.png',fullPage:true});
  await page.goto(base+'/wrong');await page.getByRole('heading',{name:'1. 每日測試題目 1',exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS daily entry/settings/30-question flow/12-of-30 resume/no provenance hints/wrong book/idempotent local progress/four widths');
} finally {await browser.close();}
