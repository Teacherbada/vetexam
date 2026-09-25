import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.TEST_BASE_URL||'http://localhost:3241';
const browser=await chromium.launch({channel:'msedge',headless:true});
const subject='獸醫病理學',chapter='腫瘤';
const question={id:1,questionSetId:1,questionNumber:1,subject,question:'下列何者最符合腫瘤的特徵？',options:['甲','乙','丙','丁'],answer:'A',explanation:'原有解析',examYear:115,questionSetName:'fixture'};
try {
  await mkdir('.artifacts',{recursive:true});
  for(const width of [360,375,390,412,1280]) {
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    let owner='alice', failImport=false, answers=0;
    let quizQuestions=[question];
    const snapshot={owner,progress:{[subject]:{answered:Array.from({length:20},(_,i)=>i+1),correct:10,wrong:10}},favorites:[],wrongQuestions:[],legacy:[],history:Array.from({length:20},(_,i)=>({question_id:i+1,subject,chapter,is_correct:i<10,mode:'practice',answered_at:new Date(Date.now()-86400000).toISOString()}))};
    await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),path=url.pathname;
      let json={};
      if(path==='/api/auth/get-session') json=owner?{user:{id:owner,name:'Fixture',email:'fixture@example.test',emailVerified:true},session:{id:'fixture',userId:owner,expiresAt:new Date(Date.now()+86400000).toISOString()}}:null;
      else if(path==='/api/learning') {
        if(route.request().method()==='GET')json={...snapshot,owner};
        else {
          const body=route.request().postDataJSON();assert.equal(body.owner,owner);
          if(body.action==='import'&&failImport)return route.fulfill({status:503,json:{error:'offline'}});
          if(body.action==='answers'){answers+=body.answers.length;snapshot.wrongQuestions=[{...question,note:'',userAnswer:'B'}];}
          if(body.action==='review'&&body.field==='favorite')snapshot.favorites=body.value?[question]:[];
          if(body.action==='review'&&body.field==='note')snapshot.wrongQuestions[0].note=body.value;
          if(body.action==='review'&&body.field==='wrong')snapshot.wrongQuestions=[];
          json={success:true};
        }
      } else if(path==='/api/quiz')json=url.searchParams.has('settings')?{availability:[{subject,year:115,count:20}],chapterAvailability:[]}:{questions:quizQuestions};
      else if(path==='/api/stats/chapter-frequency')json={rows:[{subject,chapter,year:115,paper:1,count:20}]};
      else if(path==='/api/stats/difficulty')json={total:20,rate:65,label:'普通'};
      else if(path==='/api/stats/option-distribution')json={total:0,sufficient:false,min_attempts:5,options:[]};
      else if(path==='/api/stats/answers')json={success:true};
      else if(path==='/api/admin/status')json={isAdmin:false};
      return route.fulfill({json});
    });
    await page.goto(base+'/analysis');
    await page.getByText('帳號・全部紀錄',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'近期學習趨勢'}).waitFor();
    await page.getByRole('heading',{name:'弱點 × 出題頻率：建議優先複習'}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`analysis overflow ${width}`);
    await page.screenshot({path:`.artifacts/analysis-${width}.png`,fullPage:true});
    await page.goto(base+'/');
    await page.waitForFunction(()=>document.querySelector('.study-progress-summary dd')?.textContent==='20 題');
    await page.goto(base+'/subjects');
    await page.getByRole('button',{name:`選擇${subject}，設定練習`,exact:true}).click();
    await page.getByRole('button',{name:'未做過',exact:true}).click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`filters overflow ${width}`);
    await page.screenshot({path:`.artifacts/filters-${width}.png`,animations:'disabled'});
    await page.getByRole('link',{name:'開始刷題 →',exact:true}).click();
    await page.waitForURL('**/questions?**');
    assert.equal(new URL(page.url()).searchParams.get('state'),'unanswered');
    await page.getByRole('heading',{name:question.question}).waitFor();
    await page.getByRole('button',{name:'收藏題目',exact:true}).click();
    await page.getByRole('button',{name:'B 乙',exact:false}).click();
    await page.getByText('難度：普通',{exact:true}).waitFor();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('learningOutbox:alice')||'[]').length===0);
    assert.equal(answers,1);
    await page.goto(base+'/favorites');await page.getByText('1. '+question.question,{exact:true}).waitFor();
    await page.goto(base+'/wrong');const note=page.getByRole('textbox');await note.fill('記住良性與惡性的區別');await note.blur();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('learningOutbox:alice')||'[]').length===0);
    await page.reload();await page.getByRole('textbox').waitFor();assert.equal(await page.getByRole('textbox').inputValue(),'記住良性與惡性的區別');
    await page.getByRole('button',{name:'已掌握，移除第 1 題'}).click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('learningOutbox:alice')||'[]').length===0);
    // Retryable failed migration keeps originals and never marks completion.
    await page.evaluate(()=>{localStorage.removeItem('learningMigrated:alice');localStorage.setItem('progress',JSON.stringify({old:{answered:[99],correct:1,wrong:0}}));});
    failImport=true;await page.goto(base+'/analysis');await page.getByRole('heading',{name:'近期學習趨勢'}).waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('learningMigrated:alice')),null);
    assert.match(await page.evaluate(()=>localStorage.getItem('progress')),/99/);
    failImport=false;await page.getByRole('button',{name:'重試同步',exact:true}).click();
    await page.waitForFunction(()=>localStorage.getItem('learningMigrated:alice')==='1');
    quizQuestions=[question,{...question,id:2,question:'第二題測試題目'}];
    await page.goto(base+'/questions?'+new URLSearchParams({started:'1',mode:'exam',groups:JSON.stringify([{subject,years:[],count:'2'}])}));
    await page.getByRole('heading',{name:question.question}).waitFor();await page.getByRole('button',{name:'B 乙',exact:false}).click();
    assert.equal(answers,1,'exam selections are not submitted before completion');
    await page.getByRole('button',{name:'下一題',exact:false}).click();await page.getByRole('button',{name:'A 甲',exact:false}).click();
    await page.getByRole('heading',{name:'完成這次測驗了'}).waitFor();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('learningOutbox:alice')||'[]').length===0);
    assert.equal(answers,3);quizQuestions=[question];
    // Guest practice stays available and never posts account history.
    owner=null;await page.goto(base+'/questions?'+new URLSearchParams({started:'1',groups:JSON.stringify([{subject,years:[],count:'1'}])}));
    await page.getByRole('heading',{name:question.question}).waitFor();await page.getByRole('button',{name:'A 甲',exact:false}).click();
    await page.getByText('難度：普通',{exact:true}).waitFor();assert.equal(answers,3);
    assert.deepEqual(errors,[]);await page.close();console.log(`PASS account flows and layout at ${width}px`);
  }
} finally {await browser.close();}
