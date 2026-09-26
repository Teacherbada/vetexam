import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:3307';
const out='.tmp/home-inline-quiz';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[];
async function setup({source='weekly',answer='E',fail=false}={}){
 const page=await browser.newPage({viewport:{width:1280,height:1000}});const posts=[];let attempts=0;
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
 await page.route('**/api/**',r=>{const u=new URL(r.request().url()),p=u.pathname;let json={};
 if(r.request().method()==='POST'){posts.push({path:p,body:r.request().postDataJSON()});return r.fulfill({json:{success:true}});}
 if(p==='/api/auth/get-session')json=null;
 else if(p==='/api/stats/weekly-most-missed')json={source,min_attempts:10,question:{question_id:7,question_number:12,exam_subject:'獸醫病理學',question:'關於細胞受到傷害後的變化，下列敘述何者正確？',wrong_attempts:12,total_attempts:20}};
 else if(p==='/api/quiz'&&u.searchParams.has('questionId')){attempts++;if(fail&&attempts===1)return r.fulfill({status:503,json:{error:'fixture'}});json={questions:[{id:7,questionSetId:1,questionNumber:12,subject:'獸醫病理學',question:'關於細胞受到傷害後的變化，下列敘述何者正確？',options:['所有細胞損傷皆不可逆','細胞適應必定導致壞死','細胞損傷與缺氧無關','細胞不會受到化學物質影響','輕微且短暫的細胞損傷可能恢復'],answer,explanation:'細胞受到輕微、短暫的傷害時，移除刺激後可能恢復正常功能。',examYear:115,questionSetName:'測試題'}]};}
 else if(p==='/api/quiz')json={availability:[],chapterAvailability:[]};
 else if(p==='/api/stats/option-distribution')json={total:1,sufficient:false,min_attempts:5,options:[]};
 else if(p==='/api/stats/difficulty')json={total:1,rate:null,label:'資料累積中'};
 return r.fulfill({json});});
 await page.goto(base);await page.locator('.study-register').waitFor();return {page,posts};
}
try{
 const {page,posts}=await setup();const group=page.getByRole('group',{name:'本週最多人答錯答案選項'});await group.waitFor();assert.equal(await group.getByRole('button').count(),5);assert.equal(await page.getByRole('dialog').count(),0);assert.equal(posts.length,0);
 for(const width of [320,375,430,768,1024,1280,1440]){await page.setViewportSize({width,height:1000});await group.scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await group.getByRole('button').count(),5);if([375,1280].includes(width)){await page.locator('.study-weekly').screenshot({path:out+'/before-answer-'+width+'.png'});}}
 const url=page.url();await group.getByRole('button').nth(4).focus();await page.keyboard.press('Enter');await page.getByRole('region',{name:'答案與解析'}).waitFor();await page.waitForTimeout(300);assert.equal(page.url(),url);assert.equal(await page.getByRole('dialog').count(),0);assert.match(await page.getByRole('region',{name:'答案與解析'}).innerText(),/你的答案：E · 正確答案：E/);assert.equal(await group.locator('button:disabled').count(),5);await page.keyboard.press('Enter');assert.equal(posts.filter(p=>p.path==='/api/stats/answers').length,1);assert.deepEqual(posts.find(p=>p.path==='/api/stats/answers').body,{answers:[{question_id:7,selected_answer:'E'}]});assert.equal(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('dailyProgress')))[0].completed),1);
 for(const width of [375,1280]){await page.setViewportSize({width,height:1000});await page.locator('.study-weekly').screenshot({path:out+'/answered-'+width+'.png'});}await page.close();
 for(const opts of [{source:'random_fallback',answer:'E',fail:true},{answer:''}]){const {page:p,posts:ps}=await setup(opts);if(opts.fail){await p.getByText('暫時無法載入題目。').waitFor();await p.getByRole('region',{name:'今日隨機挑戰作答'}).getByRole('button',{name:'重新載入'}).click();}const g=p.getByRole('group',{name:/答案選項/});await g.getByRole('button').first().click();await p.getByRole('region',{name:'答案與解析'}).waitFor();await p.waitForTimeout(300);if(opts.answer){assert.match(await p.getByRole('region',{name:'答案與解析'}).innerText(),/你的答案：A · 正確答案：E/);assert.equal(ps.filter(x=>x.path==='/api/stats/answers').length,1);assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('wrongQuestions'))[0].userAnswer),'A');assert.equal(await p.locator('.study-weekly-rank').count(),0);}else{assert.equal(ps.length,0);assert.match(await p.getByRole('region',{name:'答案與解析'}).innerText(),/暫不計入作答統計/);}await p.close();}
 assert.deepEqual(errors,[]);console.log('PASS inline weekly/fallback: auto options, E answer, wrong answer, missing answer, retry, keyboard, no navigation/modal, one write only, 7 widths.');
}finally{await browser.close();}


