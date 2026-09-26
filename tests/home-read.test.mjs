import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
function load(path, mocks = {}) {
 const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(name==='server-only')return {};if(name in mocks)return mocks[name];throw Error(name);},exports);return exports;
}
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
const summary=(owner,n=1)=>({owner,progress:{subject:{completed:n,correct:n,wrong:0}},todayCompleted:n,todayDate:date()});
const full=(owner,n=2)=>({owner,progress:{subject:{answered:Array.from({length:n},(_,i)=>i),correct:n,wrong:0}},history:[],favorites:[],wrongQuestions:[],legacy:[]});
const tick=()=>new Promise(r=>setTimeout(r,0));

test('admin status deduplicates simultaneous same-account calls without caching permissions',async()=>{
 const old=globalThis.fetch;let calls=0,finish;globalThis.fetch=async()=>{calls++;return new Promise(r=>{finish=()=>r(Response.json({isAdmin:true}));});};
 try{const {readAdminStatus}=load('lib/admin-status-client.ts');const a=readAdminStatus('alice'),b=readAdminStatus('alice');assert.equal(a,b);assert.equal(calls,1);finish();assert.equal(await a,true);const c=readAdminStatus('alice');assert.equal(calls,2);finish();await c;}finally{globalThis.fetch=old;}
});

test('shared URL builder preserves detailed settings and Quick 20 starts public practice directly',()=>{
 const {buildQuizUrl}=load('lib/quiz-url.ts');const groups=[{subject:'獸醫病理學',years:[],count:'20'}];const q=new URL(buildQuizUrl(groups,'random','practice','all'),'http://test').searchParams;
 assert.deepEqual(JSON.parse(q.get('groups')),groups);for(const [key,value] of Object.entries({order:'random',mode:'practice',state:'all',started:'1'}))assert.equal(q.get(key),value);assert.equal(q.has('subjects'),false);
 const detailed=[{subject:'獸醫病理學',years:[2026],chapter:'腫瘤',count:'all'}];assert.deepEqual(JSON.parse(new URL(buildQuizUrl(detailed,'original','exam','wrong'),'http://test').searchParams.get('groups')),detailed);
});

test('summary is available before full sync; full sync wins over a late summary',async()=>{
 const old=globalThis.fetch;const values=new Map([['learningMigrated:alice','1']]);globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 let finishFull, finishSummary;globalThis.fetch=async url=>new Promise(resolve=>{if(url.endsWith('/summary'))finishSummary=()=>resolve(Response.json(summary('alice')));else finishFull=()=>resolve(Response.json(full('alice')));});
 try{const c=load('lib/learning-client.ts');const pending=c.setLearningOwner('alice');await tick();finishSummary();await tick();assert.equal(c.getLearningSummary().todayCompleted,1);assert.equal(c.getLearning(),null);finishFull();await pending;assert.equal(c.getLearningSummary().progress.subject.completed,2);
 const again=c.setLearningOwner('alice');assert.equal(c.getLearningSummary().progress.subject.completed,2);await tick();finishFull();await again;finishSummary();await tick();assert.equal(c.getLearningSummary().progress.subject.completed,2);
 }finally{globalThis.fetch=old;delete globalThis.localStorage;}
});

test('cache owner/date validation, logout, account switching and late responses cannot leak records',async()=>{
 const old=globalThis.fetch;const values=new Map([['learningMigrated:alice','1'],['learningMigrated:bob','1'],['learningSummary:v1:alice',JSON.stringify(summary('alice',8))],['learningSummary:v1:bob',JSON.stringify(summary('alice',99))]]);
 globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};const requests=[];globalThis.fetch=async url=>new Promise(resolve=>requests.push({url,resolve}));
 try{const c=load('lib/learning-client.ts');const a=c.setLearningOwner('alice');assert.equal(c.getLearningSummary().todayCompleted,8);await tick();const b=c.setLearningOwner('bob');assert.equal(c.getLearningSummary(),null);await tick();
 requests[0].resolve(Response.json(summary('alice',99)));requests[1].resolve(Response.json(full('alice',99)));await a;assert.equal(c.getLearningSummary(),null);
 requests[2].resolve(Response.json(summary('bob',3)));requests[3].resolve(Response.json(full('bob',3)));await b;assert.equal(c.getLearningSummary().owner,'bob');await c.setLearningOwner(null);assert.equal(c.getLearningSummary(),null);
 values.set('learningSummary:v1:alice',JSON.stringify({...summary('alice'),todayDate:'2000-01-01'}));const p=c.setLearningOwner('alice');assert.equal(c.getLearningSummary(),null);await tick();requests[4].resolve(Response.json(summary('alice')));requests[5].resolve(Response.json(full('alice')));await p;
 }finally{globalThis.fetch=old;delete globalThis.localStorage;}
});

test('cached summary survives network failure and retry updates it without losing outbox semantics',async()=>{
 const old=globalThis.fetch;const values=new Map([['learningMigrated:alice','1'],['learningSummary:v1:alice',JSON.stringify(summary('alice',4))]]);globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};let fail=true;
 globalThis.fetch=async url=>{if(fail)throw Error('offline');return Response.json(url.endsWith('/summary')?summary('alice',2):full('alice',2));};
 try{const c=load('lib/learning-client.ts');await c.setLearningOwner('alice');assert.equal(c.getLearningSummary().todayCompleted,4);assert.equal(c.getLearningStatus(),'error');fail=false;await c.retryLearning();assert.equal(c.getLearningSummary().progress.subject.completed,2);assert.equal(c.getLearningStatus(),'ready');}finally{globalThis.fetch=old;delete globalThis.localStorage;}
});

test('summary route uses authenticated owner only and forbids shared HTTP caching',async()=>{
 let id=null,seen;const api=load('app/api/learning/summary/route.ts',{'@/lib/auth':{auth:{api:{getSession:async()=>id?{user:{id}}:null}}},'@/lib/question-transaction':{questionTransaction:fn=>fn({})},'@/lib/learning-service':{readLearningSummary:async(_,owner)=>{seen=owner;return summary(owner);}}});
 assert.deepEqual(await(await api.GET(new Request('http://test/api/learning/summary?owner=other'))).json(),{owner:null});id='alice';const r=await api.GET(new Request('http://test/api/learning/summary?owner=bob'));assert.equal(seen,'alice');assert.equal(r.headers.get('cache-control'),'private, no-store');
});

test('public caches have bounded TTL, share repeat reads, and preserve explicit weekly/fallback/empty sources',async()=>{
 let weekly=[{question_id:1,wrong_attempts:10,total_attempts:12}],fallback=[{question_id:2}],weeklyQueries=0,fallbackQueries=0;const specs=[];
 function create(){return load('lib/home-public-data.ts',{'next/cache':{unstable_cache:(fn,keys,options)=>{specs.push({keys,options});let cached;return()=>cached??=fn();}},'@neondatabase/serverless':{neon:()=>({query(){}})},'./question-stats':{MIN_ATTEMPTS:10,weeklyMostMissed:async()=>{weeklyQueries++;return weekly;},randomPublicChallenge:async()=>{fallbackQueries++;return fallback;}}});}
 const prev=process.env.DATABASE_URL;process.env.DATABASE_URL='fixture';try{let api=create();let r=await api.readWeeklyChallenge();assert.equal(r.source,'weekly');await api.readWeeklyChallenge();assert.equal(weeklyQueries,1);assert.equal(fallbackQueries,0);weekly=[];api=create();r=await api.readWeeklyChallenge();assert.equal(r.source,'random_fallback');assert.equal(r.question.wrong_attempts,undefined);fallback=[];api=create();r=await api.readWeeklyChallenge();assert.equal(r.question,null);assert.equal(r.source,null);assert.deepEqual(specs.slice(0,2).map(s=>s.options.revalidate),[120,60]);}finally{if(prev===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=prev;}
});
