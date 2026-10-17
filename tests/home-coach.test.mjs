import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fixture,loadCoach,evidence,daily} from './helpers/coach-v2-fixture.mjs';
const f=await fixture(),service=loadCoach('lib/home-coach-service.ts'),learning=loadCoach('lib/learning-service.ts');
const mocks={'@/lib/auth':{auth:{api:{getSession:async({headers})=>headers.get('x-test-user')?{user:{id:headers.get('x-test-user')}}:null}}},'@/lib/question-transaction':{questionTransaction:f.transaction}};
const route=loadCoach('app/api/study-plan/home/route.ts',mocks);
const request=(user,method='GET',headers={})=>new Request('https://vetexam.test/api/study-plan/home?userId=a',{method,headers:{...(user?{'x-test-user':user}:{}),...headers}});
const read=user=>f.transaction(tx=>service.readHomeCoach(tx,user));
try{
 await f.query("UPDATE study_plans SET mode='custom' WHERE user_id='b'");await f.query("DELETE FROM study_plans WHERE user_id='c'");
 for(const user of ['b','c']){let count=0;const result=await service.readHomeCoach({query:async(...args)=>{count++;return f.db.query(...args);}},user);assert.equal(count,1);assert.deepEqual(result,{owner:user,enabled:false,task:null});}
 assert.equal((await route.GET(request(null))).status,401);
 assert.equal((await route.POST(request('a','POST',{'origin':'https://evil.test'}))).status,403);
 assert.equal((await route.POST(request('a','POST',{'sec-fetch-site':'cross-site'}))).status,403);
 assert.equal((await route.POST(request('b','POST'))).status,200);assert.equal((await f.query('SELECT count(*)::int n FROM daily_tasks'))[0].n,0);
 const initial=await (await route.POST(request('a','POST'))).json();assert(initial.diagnostic);assert.equal(initial.task,null);
 await f.seed();assert.equal((await read('a')).task,null,'GET does not create tasks');
 const created=await route.POST(request('a','POST'));assert.equal(created.status,200);assert.match(created.headers.get('cache-control'),/private, no-store/);
 let home=await created.json();assert.equal(home.task.total,20);assert.equal(home.task.answered,0);assert.equal(home.task.remaining,20);assert.equal(home.task.groups.length,3);assert.equal(home.todayTotal,0);
 let reads=0;await service.readHomeCoach({query:async(...args)=>{reads++;return f.db.query(...args);}},'a');assert.equal(reads,2,'fixed query budget, not per question');
 const original=await f.read('a');await route.POST(request('a','POST'));assert.equal((await f.read('a')).task.id,original.task.id);
 // Same assigned question answered freely updates evidence and the daily total,
 // not its assignment receipt. Replaying the event must remain idempotent.
 const [{question_id}]=await f.query('SELECT i.question_id FROM daily_task_items l JOIN diagnostic_items i ON i.session_id=l.session_id AND i.position=l.item_position WHERE l.task_id=$1 ORDER BY l.position LIMIT 1',[original.task.id]);
 const answer={question_id,selected_answer:'B',event_id:randomUUID()};
 await f.transaction(tx=>learning.recordPractice(tx,'a',[answer],'practice'));await f.transaction(tx=>learning.recordPractice(tx,'a',[answer],'practice'));
 home=await read('a');assert.equal(home.todayTotal,1);assert.equal(home.task.answered,0);assert.equal(home.task.review.answered,0);
 assert((await f.transaction(tx=>evidence.readCoachEvidence(tx,'a'))).some(e=>e.id===question_id&&!e.correct));
 const group=original.coach.groups.find(g=>g.current);await f.answer('a',original.task.id,group.current.position);await f.answer('a',original.task.id,group.current.position);
 home=await read('a');assert.equal(home.todayTotal,2);assert.equal(home.task.answered,1);assert.equal(home.task.remaining,19);assert.equal(home.task.groups.reduce((n,g)=>n+g.answered,0),1);
 assert(!JSON.stringify(home).includes('answer_key'));assert(!JSON.stringify(home).includes('explanation'));assert(!JSON.stringify(home).includes('question_id'));
 // Read on another device gets the same persisted receipt; forged owner ignored.
 assert.deepEqual(await (await route.GET(request('a'))).json(),home);assert.equal((await (await route.GET(request('b'))).json()).enabled,false);
 const compact=await f.transaction(tx=>daily.setBusyMode(tx,'a',true));assert.equal((await read('a')).task.compact.total,5);
 for(const position of compact.coach.busy.positions)await f.answer('a',original.task.id,position);
 home=await read('a');assert(home.task.compact.completed);assert(!home.task.completed);assert.equal(home.task.answered,6);assert.equal(home.todayTotal,7);
 await f.query("UPDATE study_plans SET mode='custom' WHERE user_id='a'");assert.equal((await read('a')).enabled,false);await f.query("UPDATE study_plans SET mode='coach' WHERE user_id='a'");assert.equal((await read('a')).task.answered,6);
 // AI and private events do not contribute to the home total.
 for(const id of [9000,9001])await f.query("INSERT INTO practice_attempts(user_id,event_id,question_id,selected_answer,is_correct,mode) VALUES('a',$1,$2,'A',true,'practice')",[randomUUID(),id]);assert.equal((await read('a')).todayTotal,7);
 // Taipei boundary: yesterday's receipts are retained but never shown as today.
 const today=(await read('a')).date;await f.query("UPDATE daily_tasks SET local_date=local_date-1 WHERE id=$1",[original.task.id]);assert.equal((await read('a')).task,null);assert.equal((await read('a')).date,today);
 // A guest bootstrap must not touch auth/database. Failure closes the card.
 let calls=0;const boot=loadCoach('lib/home-coach-server.ts',{'./auth':{auth:{api:{getSession:async()=>{calls++;throw Error('offline');}}}},'./question-transaction':{questionTransaction:()=>{throw Error('must not run');}}});
 assert.equal((await boot.initialHomeCoach(new Headers())).enabled,false);assert.equal(calls,0);assert.equal((await boot.initialHomeCoach(new Headers({cookie:'session=test'}))).enabled,false);assert.equal(calls,1);
 // The original entire homepage is moved, with only the three integration edits.
 const before=execFileSync('git',['show','0e96151572670bd421289db2bf478335ff7fd4ce:app/page.tsx'],{encoding:'utf8'}).replaceAll('\r\n','\n');
 const after=readFileSync('app/Home.tsx','utf8').replaceAll('\r\n','\n').replace('import HomeCoachCard from "@/components/dashboard/HomeCoachCard";\n','').replace("import type {HomeCoachSummary} from '@/lib/home-coach';\n",'').replace('Home({initialCoach}: {initialCoach:HomeCoachSummary})','Home()').replace(' coach={<HomeCoachCard initial={initialCoach} owner={sessionError ? null : isLoadingUser ? undefined : userId} />}','');
 const withoutLoading=after.replace("import LoadingScreen from '@/components/ui/LoadingScreen';\n",'').replace(`const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

`,'').replace(`  const sessionState = authClient.useSession();
  // Auth may resolve before this streamed boundary hydrates; retain its server snapshot.
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const session = hydrated ? sessionState.data : null;
  const isLoadingUser = !hydrated || sessionState.isPending;
  const sessionError = hydrated ? sessionState.error : null;
  const refetchSession = sessionState.refetch;`,`  const { data: session, isPending: isLoadingUser, error: sessionError, refetch: refetchSession } = authClient.useSession();`).replace(`  const [hasEnteredHome,setHasEnteredHome] = useState(false);
  const homePending = isLoadingUser || isLoadingLocalProgress || (!sessionError && isLoadingProgress) || (!availability.data && !availability.error);
  useEffect(() => {
    // Only initial readiness gates entry; background refreshes keep the page usable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!homePending) setHasEnteredHome(true);
  }, [homePending]);
`,'').replace('return (<><LoadingScreen active={!hasEnteredHome && homePending} />','return (').replace('    </div></>\n  );','    </div>\n  );');
 assert.equal(withoutLoading,before,'original cards, links, copy and styles preserved byte-for-byte beneath the loading layer');
 console.log('PASS home coach: auth/CSRF, isolated owners, 1/2 read queries, diagnostic, stable daily creation, actual receipts, free practice/evidence/idempotency, AI/private exclusion, Taipei rollover, failed bootstrap, unchanged original homepage');
}finally{await f.close();}
