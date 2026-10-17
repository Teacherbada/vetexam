import assert from 'node:assert/strict';import {test} from 'node:test';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
import {fixture,rules,daily,diagnostic,evidence,taxonomy,loadCoach} from './helpers/coach-v2-fixture.mjs';
const subject=taxonomy.EXAM_SUBJECTS[0],chapter=taxonomy.chapterGroups(subject)[0].chapters[0];
test('weakness requires distinct sample thresholds; sparse data and dates are honest',()=>{
 const sample=n=>Array.from({length:n},(_,id)=>({id,subject,chapter,correct:false,wrong_count:3,last_answered:new Date().toISOString()}));
 assert.equal(rules.coachTargets(sample(2)).length,0);assert.equal(rules.coachTargets(sample(5)).length,1);
 assert.equal(rules.coachTargets(sample(10).map(r=>({...r,chapter:null}))).length,1);
 assert(rules.coachNeedsDiagnostic(sample(12),false));assert(!rules.coachNeedsDiagnostic([],true));
 const dates=loadCoach('lib/daily-task.ts');assert.equal(dates.dailyLocalDate(new Date('2026-10-17T15:59:59Z')),'2026-10-17');assert.equal(dates.dailyLocalDate(new Date('2026-10-17T16:00:00Z')),'2026-10-18');
 for(const n of [5,20,30,60]){const q=rules.coachQuotas(n);assert(q.weakness+q.review<n);}
 assert.doesNotMatch(rules.coachFeedback([{position:1,subject,chapter,selected_answer:'A',is_correct:true}]).comment,/已精熟|有進步/);
});
test('new member is routed to existing resumable initial diagnostic, no fake daily weak task',async()=>{
 const f=await fixture();try{const v=await f.ensure('a');assert.equal(v.task,null);assert.deepEqual(v.coach.diagnostic,{completed:false,answered:0,total:0});
 const first=await f.transaction(tx=>diagnostic.startDiagnostic(tx,'a'));assert(first.session.total>0);
 await f.transaction(tx=>diagnostic.answerDiagnostic(tx,'a',{sessionId:first.session.id,position:1,answer:'A'}));
 assert.equal((await f.ensure('a')).coach.diagnostic.answered,1);
 assert.equal((await f.query('SELECT count(*)::int n FROM daily_tasks'))[0].n,0);
 }finally{await f.close();}
});
test('real three tasks persist; independent order, resume, no answer leakage, results and idempotency',async()=>{
 const f=await fixture();try{await f.seed();let v=await f.ensure('a');assert.equal(v.task.total,20);assert(v.coach.groups.every(g=>g.total>0));const id=v.task.id;
 const plan=(await f.query('SELECT coach_plan FROM daily_tasks WHERE id=$1',[id]))[0].coach_plan;
 let readQueries=0;await f.transaction(tx=>daily.readDailyTask({query:(...args)=>{readQueries++;return tx.query(...args);}},'a'));assert(readQueries<=10,'fixed query count for saved daily plan');
 assert.equal(new Set((await f.query('SELECT source_question_id FROM daily_task_items WHERE task_id=$1',[id])).map(r=>r.source_question_id)).size,20);
 assert.doesNotMatch(JSON.stringify(v.coach.groups.map(g=>g.current)),/answer_key|selected_answer|保存解析/);
 // Start challenge before weakness. Every group has its own existing diagnostic session.
 let group=v.coach.groups.find(g=>g.key==='challenge'),position=group.current.position;
 v=await f.answer('a',id,position);assert.equal(v.task.answered,1);
 assert.equal((await f.answer('a',id,position)).task.answered,1);
 await assert.rejects(f.answer('a',id,position,'B'),e=>e.status===409);
 await assert.rejects(f.answer('b',id,position),e=>e.status===404);
 v=await f.ensure('a');assert.equal(v.task.id,id);assert.equal(v.task.answered,1);
 assert.deepEqual((await f.query('SELECT coach_plan FROM daily_tasks WHERE id=$1',[id]))[0].coach_plan,plan);
 const weak=v.coach.groups.find(g=>g.key==='weakness');await assert.rejects(f.answer('a',id,weak.positions[1]),e=>e.status===409);
 while(v.coach.groups.find(g=>g.key==='challenge').current){const g=v.coach.groups.find(g=>g.key==='challenge');v=await f.answer('a',id,g.current.position);}
 assert(v.coach.groups.find(g=>g.key==='challenge').feedback);assert.equal(v.task.completed,false);
 while(!v.task.completed){const g=v.coach.groups.find(g=>g.current);v=await f.answer('a',id,g.current.position,g.answered===0?'B':'A');}
 assert(v.coach.feedback.revisit.length);assert.equal(v.coach.feedback.answered,20);assert.equal(v.coach.week.answered,20);
 assert.equal((await f.query('SELECT count(*)::int n FROM question_answer_stats WHERE user_id=$1',['a']))[0].n,20);
 assert.equal((await f.query("SELECT count(*)::int n FROM practice_attempts WHERE user_id='a'"))[0].n,36,'coach writes reuse diagnostic items, not duplicate practice events');
 assert.equal((await f.read('a')).task.completed,true);
 }finally{await f.close();}
});
test('evidence avoids first-answer double count, excludes AI/private and counts repeat errors',async()=>{
 const f=await fixture();try{await f.seed();await f.query("INSERT INTO question_answer_stats(user_id,question_id,selected_answer,is_correct) VALUES('a',100,'B',false)");
 await f.query("INSERT INTO practice_attempts(user_id,event_id,question_id,selected_answer,is_correct,mode) VALUES('a',$1,100,'B',false,'practice'),('a',$2,9000,'B',false,'practice'),('a',$3,9001,'B',false,'practice')",[randomUUID(),randomUUID(),randomUUID()]);
 const es=await f.transaction(tx=>evidence.readCoachEvidence(tx,'a'));assert.equal(es.length,36);assert.equal(es.find(e=>e.id===100).wrong_count,2);assert(!es.some(e=>e.id>=9000));
 const pool=await f.transaction(tx=>diagnostic.diagnosticCandidates(tx,'a'));assert(!pool.some(q=>q.id>=9000));
 }finally{await f.close();}
});
test('shortages, actual due cards, same-chapter alternatives and recent avoidance',()=>{
 const now=Date.now(),old=new Date(now-40*86400000).toISOString(),recent=new Date(now-1000).toISOString();
 const pool=Array.from({length:8},(_,id)=>({id:id+1,subject,chapter,last_answered:null,last_seen:id===1?recent:null,appearances:0}));
 const memory=new Map([[1,{due:old,last_review:old}]]);
 const choice=rules.selectCoachQuestions(pool,20,[],[],now,memory);assert.equal(choice.selected.length,8);assert.equal(new Set(choice.selected.map(s=>s.row.id)).size,8);
 assert(choice.selected.filter(s=>s.group==='review').every(s=>s.row.id!==1),'same chapter alternatives before the old answer');
 assert.match(choice.reasons.review,/到期記憶/);
 const blank=rules.selectCoachQuestions([],20,[],[],now);assert.equal(blank.selected.length,0);
});
test('legacy snapshots remain unchanged; settings and new dates do not rewrite old history',async()=>{
 const f=await fixture();try{await f.seed();let v=await f.ensure('a');const id=v.task.id;
 await f.query('UPDATE daily_tasks SET coach_plan=NULL WHERE id=$1',[id]);
 v=await f.ensure('a');assert(v.coach.legacy);assert.equal(v.task.id,id);
 v=await f.answer('a',id,v.task.current.position);const receipts=v.receipts;
 await f.transaction(tx=>daily.setDailyTarget(tx,'a',30));assert.equal((await f.read('a')).task.total,20);
 await f.query("UPDATE daily_tasks SET local_date=local_date-1 WHERE id=$1",[id]);
 v=await f.ensure('a');assert.notEqual(v.task.id,id);assert.equal(v.task.target,30);assert.equal(v.task.answered,0);
 assert.equal((await f.query('SELECT status FROM daily_tasks WHERE id=$1',[id]))[0].status,'expired');
 await assert.rejects(f.answer('a',id,2),e=>e.status===409);
 assert.equal((await f.query('SELECT selected_answer FROM diagnostic_items WHERE session_id=$1 AND position=$2',receipts[0].eventId.split(':')))[0].selected_answer,'A');
 }finally{await f.close();}
});
test('migration repeat preserves existing records; shared start request and rollback',async()=>{
 const f=await fixture();try{await f.seed();const [a,b]=await Promise.all([f.ensure('a'),f.ensure('a')]);assert.equal(a.task.id,b.task.id);
 const before=await f.query('SELECT * FROM daily_tasks');await f.db.exec(readFileSync(new URL('../migrations/20261017_coach_daily_plan.sql',import.meta.url),'utf8'));assert.deepEqual(await f.query('SELECT * FROM daily_tasks'),before);
 await assert.rejects(f.transaction(async tx=>{await daily.answerDailyTask(tx,'a',{taskId:a.task.id,position:a.task.current.position,answer:'A'});throw Error('simulate rollback');}));assert.equal((await f.read('a')).task.answered,0);
 await f.query("UPDATE study_plans SET mode='custom' WHERE user_id='a'");await assert.rejects(f.ensure('a'),e=>e.status===409);assert.equal((await f.read('a')).task.id,a.task.id);
 }finally{await f.close();}
});
test('real daily API authentication, ownership, validation and no fake completion',async()=>{
 const f=await fixture();try{await f.seed();const url='https://test.local/api/study-plan/daily',call=(method,body,user='a',extra={})=>f.route[method](new Request(url,{method,headers:{...(user?{'x-test-user':user}:{}),'content-type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})}));
 for(const m of ['GET','POST','PATCH','PUT'])assert.equal((await call(m,null,null)).status,401);
 assert.equal((await call('POST',null,'a',{origin:'https://evil.test'})).status,403);
 assert.equal((await call('PUT',{userId:'b',taskId:randomUUID(),position:1,answer:'A'})).status,400);
 const r=await call('POST');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);const v=await r.json();assert.equal(v.task.answered,0);
 assert.equal((await call('PUT',{taskId:v.task.id,position:1,answer:'A'},'b')).status,404);
 assert.equal((await call('PUT',{taskId:v.task.id,position:1,answer:'A'})).status,200);
 assert.equal((await (await call('GET')).json()).task.answered,1);
 }finally{await f.close();}
});
test('existing scheduled chapter follow-up shares real responses and advances only when answered',async()=>{
 const f=await fixture();try{await f.seed();const initial=randomUUID(),task=randomUUID(),s=taxonomy.EXAM_SUBJECTS[1],c=taxonomy.chapterGroups(s)[0].chapters[0];
 await f.query("INSERT INTO diagnostic_sessions(id,user_id,completed_at) VALUES($1,'a',CURRENT_TIMESTAMP)",[initial]);
 await f.query("INSERT INTO reinforcement_tasks(id,user_id,subject,chapter,source_session_id,source_analysis,status,review_completed_at,verification_completed_at) VALUES($1,'a',$2,$3,$4,'{}','short_term',CURRENT_TIMESTAMP-interval '10 days',CURRENT_TIMESTAMP-interval '10 days')",[task,s,c,initial]);
 const store=loadCoach('lib/follow-up-store.ts');await f.transaction(tx=>store.scheduleFollowUp(tx,task));
 let v=await f.ensure('a');const links=await f.query("SELECT * FROM daily_task_items WHERE task_id=$1 AND source='follow_up' ORDER BY position",[v.task.id]);assert.equal(links.length,2);
 assert.equal((await f.query('SELECT status FROM chapter_follow_ups WHERE id=$1',[links[0].follow_up_id]))[0].status,'pending');
 const follow=loadCoach('lib/follow-up-service.ts');await f.transaction(tx=>follow.answerFollowUp(tx,'a',links[0].follow_up_id,{sessionId:links[0].session_id,position:links[0].item_position,answer:'A'}));
 v=await f.read('a');assert.equal(v.task.answered,1);v=await f.answer('a',v.task.id,links[1].position);
 assert.equal((await f.query('SELECT status FROM chapter_follow_ups WHERE id=$1',[links[0].follow_up_id]))[0].status,'completed');
 assert.equal((await f.query('SELECT count(*)::int n FROM chapter_follow_ups WHERE reinforcement_task_id=$1',[task]))[0].n,2);
 assert.equal((await f.answer('a',v.task.id,links[1].position)).task.answered,2);
 const prior=randomUUID();await f.query("INSERT INTO daily_tasks(id,user_id,local_date,target_count,status) VALUES($1,'a',(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date-1,2,'expired')",[prior]);
 await f.query("INSERT INTO daily_task_items SELECT $1,user_id,position,source,source_question_id,session_id,item_position,follow_up_id FROM daily_task_items WHERE task_id=$2 AND source='follow_up'",[prior,v.task.id]);
 assert.equal((await f.read('a')).coach.week.answered,2,'same follow-up answer linked on two dates counts once in the week');
 }finally{await f.close();}
});
