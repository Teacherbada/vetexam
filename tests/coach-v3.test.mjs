import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture,loadCoach,taxonomy,daily,diagnostic,rules} from './helpers/coach-v2-fixture.mjs';
const personal=loadCoach('lib/coach-personalization.ts'),reports=loadCoach('lib/coach-report-service.ts');
const subject=taxonomy.EXAM_SUBJECTS[0],chapter=taxonomy.chapterGroups(subject)[0].chapters[0];
const input={subject,chapter,questionId:100};
test('chapter interval 1/3/7/14/30, wrong reset, delayed lapse, same-day cap and one chapter entry',()=>{
 let r=personal.reviewAfterAnswer(undefined,{...input,correct:false,date:'2026-10-17'});
 assert.equal(r.due,'2026-10-18');assert.equal(r.step,0);
 const same=personal.reviewAfterAnswer(r,{...input,correct:true,date:'2026-10-17'});assert.deepEqual(same,r);
 r=personal.reviewAfterAnswer(r,{...input,correct:false,date:'2026-10-18'});assert.equal(r.due,'2026-10-19');assert.equal(r.failures,2);
 for(const interval of [3,7,14,30,30]){const date=r.due;r=personal.reviewAfterAnswer(r,{...input,correct:true,date});assert.equal(r.due,personal.addDays(date,interval));}
 const due=r.due;r=personal.reviewAfterAnswer(r,{...input,correct:false,date:personal.addDays(due,2)});assert.equal(r.step,0);assert.equal(r.lapses,1);assert.equal(r.due,personal.addDays(due,3));
 assert.equal(personal.reviewAfterAnswer(undefined,{...input,correct:true,date:'2026-10-17'}),undefined);
 assert.equal(personal.reviewAfterAnswer(undefined,{...input,chapter:'not official',correct:false,date:'2026-10-17'}),undefined);
 assert.equal(personal.coachWeek('2026-10-18'),'2026-10-12');assert.equal(personal.coachWeek('2026-10-19'),'2026-10-19');
});
test('future review stays deferred, scarce pools use original safely, regression needs enough samples',()=>{
 const now=Date.parse('2026-10-17T00:00:00Z'),pool=[{id:100,subject,chapter,last_seen:null,appearances:0,last_answered:null}];
 const evidence=[{id:100,subject,chapter,correct:false,previous_correct:true,wrong_count:2,last_answered:'2026-10-16T00:00:00Z'}];
 const deferred=rules.selectCoachQuestions(pool,5,[],evidence,now,new Map(),{reviews:[],focus:null,deferred:[personal.reviewKey(subject,chapter)]});
 assert.equal(deferred.selected.filter(s=>s.group==='review').length,0);assert.equal(rules.coachTargets(evidence).length,0);
 const review={...input,due:'2026-10-17',lastDate:'2026-10-16',step:0,failures:2,lapses:0,lastCorrect:false};
 const due=rules.selectCoachQuestions(pool,5,[],evidence,now,new Map(),{reviews:[review],focus:subject});assert.equal(due.selected.length,1);assert.equal(due.selected[0].row.id,100);assert.equal(due.selected[0].group,'review');
 const enough=Array.from({length:5},(_,n)=>({...evidence[0],id:100+n}));assert.equal(rules.coachTargets(enough)[0].declines,5);
});
test('new coach answer saves one review, retry/rollback cannot double count, custom and private excluded',async()=>{
 const f=await fixture();try{await f.seed();let v=await f.ensure('a');const p=v.coach.groups.find(g=>g.key==='weakness').current.position;
 const before=await f.query('SELECT * FROM questions ORDER BY id');
 await f.answer('a',v.task.id,p,'B');let state=(await f.query("SELECT coach_state FROM study_plans WHERE user_id='a'"))[0].coach_state;
 assert.equal(Object.keys(state.reviews).length,1);const review=Object.values(state.reviews)[0];assert.equal(review.due,personal.addDays(v.date,1));
 await f.answer('a',v.task.id,p,'B');assert.deepEqual((await f.query("SELECT coach_state FROM study_plans WHERE user_id='a'"))[0].coach_state,state);
 v=await f.read('a');const next=v.coach.groups.find(g=>g.key==='weakness').current.position;
 await assert.rejects(f.transaction(async tx=>{await daily.answerDailyTask(tx,'a',{taskId:v.task.id,position:next,answer:'B'});throw Error('rollback');}));
 assert.deepEqual((await f.query("SELECT coach_state FROM study_plans WHERE user_id='a'"))[0].coach_state,state);
 await f.answer('a',v.task.id,next,'B');state=(await f.query("SELECT coach_state FROM study_plans WHERE user_id='a'"))[0].coach_state;
 assert.equal(Object.keys(state.reviews).length,1);assert.equal(Object.values(state.reviews)[0].failures,2);
 const record=loadCoach('lib/coach-personalization-service.ts');
 await f.transaction(tx=>record.recordCoachReview(tx,'a',{question_id:9000,subject,chapter},false));assert.deepEqual((await f.query("SELECT coach_state FROM study_plans WHERE user_id='a'"))[0].coach_state,state);
 await f.query("UPDATE study_plans SET mode='custom' WHERE user_id='b'");
 const id=await f.transaction(tx=>diagnostic.createDiagnosticSession(tx,'b',[{id:100,subject,chapter}],'custom'));
 await f.transaction(tx=>diagnostic.answerDiagnostic(tx,'b',{sessionId:id,position:1,answer:'B'},'custom'));
 assert.equal((await f.query("SELECT coach_state FROM study_plans WHERE user_id='b'"))[0].coach_state,null);
 assert.deepEqual(await f.query('SELECT * FROM questions ORDER BY id'),before);
 }finally{await f.close();}
});
test('due review picks different chapter questions, retains preference/other subjects and stable daily plan',async()=>{
 const f=await fixture();try{await f.seed();const date=(await f.read('a')).date;
 const state=personal.emptyCoachState();state.reviews[personal.reviewKey(subject,chapter)]={...input,lastDate:personal.addDays(date,-1),due:date,step:0,failures:2,lapses:0,lastCorrect:false};state.focus={subject:taxonomy.EXAM_SUBJECTS[3],week:personal.coachWeek(date)};
 await f.query("UPDATE study_plans SET coach_state=$1::jsonb WHERE user_id='a'",[JSON.stringify(state)]);
 const v=await f.ensure('a'),group=v.coach.groups.find(g=>g.key==='review');assert.match(group.reason,/間隔複習/);
 const positions=await f.query('SELECT source_question_id FROM daily_task_items WHERE task_id=$1 AND position=ANY($2::int[])',[v.task.id,group.positions]);
 assert(positions.every(r=>r.source_question_id!==100));assert.equal(group.total,5);
 assert(v.coach.groups.find(g=>g.key==='challenge').focus.some(s=>s.startsWith(taxonomy.EXAM_SUBJECTS[3])));
 assert(v.coach.groups.find(g=>g.key==='challenge').focus.length>1);
 assert.deepEqual((await f.ensure('a')).coach.groups,v.coach.groups);
 const key=personal.reviewKey(subject,chapter);await f.answer('a',v.task.id,group.current.position,'A');
 const after=(await f.query("SELECT coach_state FROM study_plans WHERE user_id='a'"))[0].coach_state;
 assert.equal(after.reviews[key].due,personal.addDays(date,3));
 }finally{await f.close();}
});
test('busy plan is persisted subset, respects session ordering, partial progress and full task remain',async()=>{
 const f=await fixture();try{await f.seed();let v=await f.ensure('a');v=await f.answer('a',v.task.id,v.coach.groups[0].current.position);
 const original=(await f.query('SELECT coach_plan FROM daily_tasks WHERE id=$1',[v.task.id]))[0].coach_plan;
 v=await f.transaction(tx=>daily.setBusyMode(tx,'a',true));const positions=v.coach.busy.positions;
 assert.equal(positions.length,5);assert.equal(v.target,20);assert.equal(v.task.total,20);assert.equal(v.task.answered,1);assert(v.coach.busy.enabled);
 assert.equal(v.coach.busy.current.position,v.coach.groups.find(g=>g.key==='review').current.position,'busy starts with review, not the lower global position');
 assert.deepEqual((await f.ensure('a')).coach.busy.positions,positions);
 while(v.coach.busy.current)v=await f.answer('a',v.task.id,v.coach.busy.current.position);
 assert(v.coach.busy.completed);assert.equal(v.task.completed,false);assert.equal(v.task.answered,6);
 const report=await f.transaction(tx=>reports.readCoachReport(tx,'a'));assert.equal(report.weekStats.completedDays,1);assert.equal(report.weekStats.reviewDone,v.coach.groups.find(g=>g.key==='review').answered);
 v=await f.transaction(tx=>daily.setBusyMode(tx,'a',false));assert(!v.coach.busy.enabled);assert.equal(v.task.total,20);
 v=await f.transaction(tx=>daily.setBusyMode(tx,'a',true));assert(v.coach.busy.completed);assert.deepEqual(v.coach.busy.positions,positions);
 assert.deepEqual((await f.query('SELECT coach_plan FROM daily_tasks WHERE id=$1',[v.task.id]))[0].coach_plan.groups,original.groups);
 assert.deepEqual((await f.read('a')).coach.busy,v.coach.busy);
 }finally{await f.close();}
});
test('focus persists week only, validates ownership/origin/payload, never reorders today',async()=>{
 const f=await fixture();try{await f.seed();const v=await f.ensure('a');
 const call=(method,body,user='a',headers={})=>f.coachRoute[method](new Request('https://test.local/api/study-plan/coach',{method,headers:{...(user?{'x-test-user':user}:{}),'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})}));
 for(const method of ['GET','PUT'])assert.equal((await call(method,null,null)).status,401);
 assert.equal((await call('PUT',{subject},'a',{origin:'https://evil.test'})).status,403);
 for(const body of [{subject:'fake'},{subject,userId:'b'},{subject,week:'2030-01-01'},{busy:true}])assert.equal((await call('PUT',body)).status,400);
 assert.equal((await call('PUT',{subject})).status,200);
 const result=await call('GET');assert.match(result.headers.get('cache-control'),/no-store/);assert.equal((await result.json()).focus,subject);
 assert.equal((await (await call('GET',null,'b')).json()).focus,null);
 assert.deepEqual((await f.ensure('a')).coach.groups,v.coach.groups);
 const stored=(await f.query("SELECT coach_state FROM study_plans WHERE user_id='a'"))[0].coach_state;
 assert.equal(personal.focusForWeek(stored,personal.addDays(stored.focus.week,7)),null);
 assert.equal((await call('PUT',{subject:null})).status,200);
 const dailyCall=body=>f.route.PATCH(new Request('https://test.local/api/study-plan/daily',{method:'PATCH',headers:{'x-test-user':'a','content-type':'application/json'},body:JSON.stringify(body)}));
 for(const body of [{busy:'yes'},{busy:true,userId:'b'},{busy:true,target:5}])assert.equal((await dailyCall(body)).status,400);
 assert.equal((await dailyCall({busy:true})).status,200);assert.equal((await dailyCall({busy:true})).status,200);assert.equal((await f.read('a')).task.answered,0);
 }finally{await f.close();}
});
test('weekly trends require same questions, matched chapters, real sample sizes; migration repeats safely',async()=>{
 const f=await fixture();try{
 const date=(await f.read('a')).date,week=personal.coachWeek(date),previous=personal.addDays(week,-7);
 for(const [day,correct] of [[previous,false],[week,true]]){
  const id=randomUUID();await f.query("INSERT INTO diagnostic_sessions(id,user_id,kind) VALUES($1,'a','daily')",[id]);
  await f.query(`INSERT INTO diagnostic_items(session_id,position,question_id,source_question_id,subject,chapter,question,options,answer_key,selected_answer,is_correct,answered_at)
   SELECT $1,n,99+n,99+n,$2,$3,'fixture','["a","b"]','A',$4,$5,$6::date::timestamp AT TIME ZONE 'Asia/Taipei' FROM generate_series(1,5) n`,[id,subject,chapter,correct?'A':'B',correct,day]);
 }
 const r=await f.transaction(tx=>reports.readCoachReport(tx,'a'));assert.equal(r.trends.length,1);assert.equal(r.trends[0].change,100);assert.equal(r.trends[0].count,5);
 await f.query("UPDATE diagnostic_items SET question='changed wording' WHERE question_id=104 AND is_correct");assert.equal((await f.transaction(tx=>reports.readCoachReport(tx,'a'))).trends.length,0,'revised question is not comparable');
 await f.query('DELETE FROM diagnostic_items WHERE question_id=104');assert.equal((await f.transaction(tx=>reports.readCoachReport(tx,'a'))).trends.length,0);
 assert.equal((await f.transaction(tx=>reports.readCoachReport(tx,'b'))).trends.length,0);
 const before=await f.query('SELECT * FROM study_plans ORDER BY user_id');await f.db.exec(readFileSync(new URL('../migrations/20261017_coach_personalization.sql',import.meta.url),'utf8'));assert.deepEqual(await f.query('SELECT * FROM study_plans ORDER BY user_id'),before);
 const mismatch=Array.from({length:5},(_,id)=>[{id,subject,chapter,period:'current',correct:true},{id:id+50,subject,chapter,period:'previous',correct:false}]).flat();assert.equal(personal.comparableTrends(mismatch).length,0);
 }finally{await f.close();}
});
