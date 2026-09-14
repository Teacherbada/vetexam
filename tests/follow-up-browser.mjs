import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const taxonomy={}; new Function('exports',ts.transpileModule(readFileSync('data/exam-chapters.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(taxonomy);
const subject=taxonomy.EXAM_SUBJECTS[0], chapter=taxonomy.chapterGroups(subject)[0].chapters[0];
const base=process.env.TEST_BASE_URL||'http://localhost:3137';
mkdirSync('.tmp/follow-up-artifacts',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const id='12345678-1234-1234-1234-123456789012';
  const row={id,subject,chapter,stage:1,intervals:[3,7],review_attempt:1,due_at:new Date().toISOString(),status:'pending',session_id:null,result:null};
  let state={mode:'coach',followUp:row,history:[row],session:null,activeReinforcement:false};
  let fail=false;
  await page.route('**/api/study-plan/follow-up*',async route=>{
    if(fail) return route.fulfill({status:503,json:{error:'暫時無法連線，請重試。'}});
    const method=route.request().method();
    if(method==='POST') {
      state.session={id:'12345678-1234-1234-1234-123456789013',total:2,answered:0,completed:false,current:{position:1,subject,chapter,question:'追蹤測試題目',options:['選項一','選項二']}};
      state.followUp.session_id=state.session.id;
    }
    if(method==='PUT') {
      state.session.answered++;
      if(state.session.answered===2) {
        state.session.current=null; state.session.completed=true;
        state.followUp.status='completed';state.followUp.completed_at=new Date().toISOString();state.followUp.result={correct:2,total:2,passed:true,sufficient:true,reused:0};
      } else state.session.current.position++;
    }
    return route.fulfill({json:state});
  });
  await page.goto(base+'/study-plan/follow-up'); await page.getByText('尚未到追蹤時間。',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'開始快速確認',exact:true}).count(),0);
  row.status='due'; await page.reload(); await page.getByRole('button',{name:'開始快速確認',exact:true}).click();
  await page.getByRole('heading',{name:'快速確認',exact:true}).waitFor();
  for(const width of [320,375,768,1280]) {await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'quiz overflow '+width);}
  await page.setViewportSize({width:375,height:900}); await page.screenshot({path:'.tmp/follow-up-artifacts/mobile-quiz.png',fullPage:true});
  await page.getByRole('button',{name:'A 選項一',exact:true}).click(); await page.getByRole('button',{name:'送出並繼續',exact:true}).click();
  await page.getByText('已儲存 1 / 2 題',{exact:true}).waitFor(); await page.reload(); await page.getByText('已儲存 1 / 2 題',{exact:true}).waitFor();
  await page.getByRole('button',{name:'A 選項一',exact:true}).click(); await page.getByRole('button',{name:'送出並完成追蹤',exact:true}).click();
  await page.getByRole('heading',{name:'本階段追蹤通過・短期掌握',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'掌握穩定',exact:true}).count(),0);
  row.stage=2; await page.reload(); await page.getByRole('heading',{name:'掌握穩定',exact:true}).waitFor();
  await page.screenshot({path:'.tmp/follow-up-artifacts/mobile-stable.png',fullPage:true});
  row.status='failed'; row.result={correct:1,total:2,passed:false,sufficient:true,reused:1}; await page.reload(); await page.getByRole('heading',{name:'需要再次補強',exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  fail=true; await page.reload(); await page.getByRole('button',{name:'重新載入追蹤',exact:true}).waitFor(); fail=false;
  await page.getByRole('button',{name:'重新載入追蹤',exact:true}).click();await page.getByRole('heading',{name:'需要再次補強',exact:true}).waitFor();
  const source={subject,chapter,correct:0,count:5,accuracy:0,status:'strengthen'};
  const rem={mode:'coach',task:{id,subject,chapter,status:'reviewing',source_analysis:source,review_count:1},session:null,attempts:[],completed:[],next:source,due:[{...row,status:'due',session_id:null}]};
  await page.route('**/api/study-plan/reinforcement',r=>r.fulfill({json:rem}));
  await page.route('**/api/study-plan',r=>r.fulfill({json:{mode:'coach'}}));
  await page.route('**/api/study-plan/daily',r=>r.fulfill({json:{mode:'coach',owner:'fixture',date:'2026-09-14',target:20,task:null,receipts:[],active:null,next:'done'}}));
  await page.route('**/api/study-plan/diagnostic',r=>r.fulfill({json:{mode:'coach',session:null}}));
  await page.goto(base+'/study-plan'); await page.getByText('目前補強任務與學習建議',{exact:true}).click(); await page.getByRole('link',{name:'繼續你的補強任務',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'今日複習追蹤',exact:true}).count(),0);
  rem.task.status='short_term';await page.reload();await page.getByText('目前補強任務與學習建議',{exact:true}).click();await page.getByRole('heading',{name:'今日複習追蹤',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'繼續下一個任務',exact:true}).count(),0);
  for(const width of [320,375,768,1280]) {await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'coach overflow '+width);}
  assert.deepEqual(errors,[]);
  console.log('PASS follow-up pending/due/quiz/resume/stage1/stable/failed/error recovery/coach priority and four widths');
} finally {await browser.close();}
