import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {loadImage,createCanvas} from '@napi-rs/canvas';
import {fixture,payload,png,input,service} from './helpers/proofreading-fixture.mjs';
import {answers,stats,learning,coach,load} from './helpers/multiple-answers-fixture.mjs';

test('additive migration preserves all old rows and is repeatable; actual 80-question paper, missing/duplicate numbers',async()=>{
 const f=await fixture(80);try{
  const before=await f.query('SELECT * FROM questions ORDER BY id');await f.db.exec(readFileSync(new URL('../migrations/20261014_question_proofreading.sql',import.meta.url),'utf8'));assert.deepEqual(await f.query('SELECT * FROM questions ORDER BY id'),before);
  let bank=await f.bank();assert.equal(bank.questions.length,80);assert.equal(bank.summary.reviewed,0);assert.equal(bank.numbering.valid,true);assert.deepEqual(bank.questions.map(q=>q.number),Array.from({length:80},(_,i)=>i+1));assert(!JSON.stringify(bank).includes('image_data_url'));
  await f.query('UPDATE questions SET question_number=79 WHERE question_set_id=1 AND question_number=80');bank=await f.bank();assert.deepEqual(bank.numbering.missing,[80]);assert.deepEqual(bank.numbering.duplicate,[79]);assert.equal(bank.numbering.valid,false);
 }finally{await f.close();}
});
test('edit stem and choices, delete false E, add/reorder choices, mandatory confirmation, single/multiple key and immutable identity',async()=>{
 const f=await fixture();try{
  await f.query("UPDATE questions SET option_e='誤產生 E' WHERE id=1");const other=await f.query('SELECT * FROM questions WHERE id<>1 ORDER BY id');let q=await f.detail(1);assert(q.issues.some(i=>i.includes('E')));
  await assert.rejects(f.save(payload(q,{options:q.options.slice(0,4),answer:'B',confirmAnswer:false})),/重新確認/);
  q=(await f.save(payload(q,{question:'H₂O、Na⁺、β-blocker\n中文醫學術語與特殊符號完整保留。',options:['甲修正','乙修正','丙','丁'],answer:['A','B']}))).question;
  assert.equal(q.answer,'["A","B"]');assert.equal(q.options.length,4);assert(answers.isCorrectAnswer(q.answer,'B'));assert.equal((await f.query('SELECT option_e FROM questions WHERE id=1'))[0].option_e,'');
  q=(await f.save(payload(q,{options:[...q.options,'正式第五選項'],answer:['A','E']}))).question;assert(answers.isCorrectAnswer(q.answer,'E'));assert.deepEqual((await f.query('SELECT vetexam_answer_keys($1) AS keys',[q.answer]))[0].keys,['A','E']);
  await assert.rejects(f.save(payload(q,{options:q.options.slice(0,4),answer:'E'})),/實際存在/);
  q=(await f.save(payload(q,{options:['乙修正','甲修正','丙','丁'],answer:'B'}))).question;assert.equal(q.answer,'B');assert.equal(q.id,1);
  assert.deepEqual(await f.query('SELECT * FROM questions WHERE id<>1 ORDER BY id'),other);assert.equal((await f.query('SELECT count(*)::int n FROM questions'))[0].n,4);
 }finally{await f.close();}
});
test('new/replace/remove/reorder/copy original images, public composite pixels, broken data rejection and source preservation',async()=>{
 const f=await fixture();try{
  const red=png('red'),blue=png('blue');let q=await f.detail(1);q=(await f.save(payload(q,{images:[{dataUrl:red},{dataUrl:blue}]}))).question;assert.equal(q.imageCount,2);
  assert.equal(await service.proofImage(f.query,1,0,q.revision),red);assert.equal(await service.proofImage(f.query,1,1,q.revision),blue);
  q=(await f.save(payload(q,{images:[q.images[1],q.images[0]].map(({questionId,index,revision})=>({questionId,index,revision}))}))).question;
  const [stored]=await f.query('SELECT image_data_url FROM questions WHERE id=1');const bitmap=await loadImage(stored.image_data_url);const canvas=createCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);assert.deepEqual([...ctx.getImageData(0,0,1,1).data],[0,0,255,255]);assert.deepEqual([...ctx.getImageData(0,20,1,1).data],[255,0,0,255]);
  let other=await f.detail(2);other=(await f.save(payload(other,{images:q.images.map(({questionId,index,revision})=>({questionId,index,revision}))}))).question;const copied=await service.proofImage(f.query,2,0,other.revision);
  q=(await f.save(payload(q,{images:[{dataUrl:red}]}))).question;assert.equal(q.imageCount,1);q=(await f.save(payload(q,{images:[]}))).question;assert.equal(q.hasImage,false);assert.equal(await service.proofImage(f.query,2,0,other.revision),copied);
  await assert.rejects(f.save(payload(q,{images:[{dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'}]})),/圖片/);
  await assert.rejects(f.save(payload(q,{images:[{dataUrl:'data:image/png;base64,ZmFrZQ=='}]})));assert.equal((await f.detail(1)).hasImage,false);
  await assert.rejects(service.proofImage(f.query,1,0,'0'.repeat(64)),/版本已更新/);
  const history=await service.proofHistory(f.query,1);assert(history.length>=4);assert(!JSON.stringify(history).includes('data:image/'));
 }finally{await f.close();}
});
test('human review, content changes via old API invalidate review, completion requires real continuous reviewed paper',async()=>{
 const f=await fixture();try{
  let bank=await f.bank();await assert.rejects(f.save({action:'complete',bankId:1,revision:bank.revision}),/逐題人工/);
  for(const row of bank.questions){const q=await f.detail(row.id);await f.save({action:'review',id:q.id,revision:q.revision,requestId:randomUUID(),confirmWarnings:true});}
  bank=await f.bank();assert.equal(bank.summary.reviewed,3);const done=await f.save({action:'complete',bankId:1,revision:bank.revision});assert.equal(done.bank.completed,true);
  await f.query("UPDATE questions SET explanation='不同解析',explanation_version=explanation_version+1 WHERE id=1");assert.equal((await f.detail(1)).reviewed,false);assert.equal((await f.bank()).completed,false);
  const q=await f.detail(2);const changed=(await f.save(payload(q,{question:'修改後仍必須人工核對完整的題幹內容。'}))).question;assert.equal(changed.reviewed,false);
  assert.equal((await f.save({action:'review',id:changed.id,revision:changed.revision,requestId:randomUUID(),confirmWarnings:false})).question.reviewed,true);
 }finally{await f.close();}
});
test('optimistic conflict, idempotent replay, single-question restore and transaction rollback',async()=>{
 const f=await fixture();try{
  const q=await f.detail(1),body=payload(q,{question:'此為更新過的完整題幹內容，保留歷史。'});const first=await f.save(body);assert.equal((await f.save(body)).replayed,true);assert.equal((await service.proofHistory(f.query,1)).length,1);
  await assert.rejects(f.save(payload(q,{question:'過期版本不可覆蓋現在的新資料。'})),/其他操作更新/);
  const [history]=await service.proofHistory(f.query,1);const restored=await f.save({action:'restore',id:1,revision:first.question.revision,requestId:randomUUID(),historyId:Number(history.id),confirmAnswer:true,confirmExplanation:true});assert.equal(restored.question.question,q.question);assert.equal(restored.question.reviewed,false);
  const snapshot=await f.query('SELECT * FROM questions');await assert.rejects(f.transaction(async tx=>{await service.changeProof(tx,payload(restored.question,{question:'應該被回滾的完整題幹內容。'}),'admin');throw Error('simulate failure');}),/simulate/);assert.deepEqual(await f.query('SELECT * FROM questions'),snapshot);
 }finally{await f.close();}
});
test('historical attempts and coach snapshots survive; explicit answer-only stats recalculation; current new answers use new key',async()=>{
 const f=await fixture();try{
  await f.transaction(tx=>learning.recordPractice(tx,'a',[{question_id:1,selected_answer:'B',event_id:randomUUID()}],'practice'));
  await f.transaction(tx=>coach.createDiagnosticSession(tx,'a',[{id:1,subject:'獸醫病理學',chapter:null}]));const history=await f.query('SELECT * FROM practice_attempts');const snapshots=await f.query('SELECT * FROM diagnostic_items');
  let q=await f.detail(1);q=(await f.save(payload(q,{answer:'B'}))).question;assert.equal((await f.query('SELECT is_correct FROM question_answer_stats WHERE question_id=1'))[0].is_correct,false);
  await stats.recordFirstAnswers(f.query,'b',[{question_id:1,selected_answer:'B'}]);assert.equal((await f.query("SELECT is_correct FROM question_answer_stats WHERE user_id='b'"))[0].is_correct,true);
  q=(await f.save(payload(q,{answer:['A','B'],recalculateStats:true}))).question;assert((await f.query('SELECT is_correct FROM question_answer_stats WHERE question_id=1')).every(r=>r.is_correct));
  await assert.rejects(f.save(payload(q,{options:['乙','甲','丙','丁'],recalculateStats:true})),/不可用新內容/);
  assert.deepEqual(await f.query('SELECT * FROM practice_attempts'),history);assert.deepEqual(await f.query('SELECT * FROM diagnostic_items'),snapshots);assert.equal(q.historyNotice,true);
 }finally{await f.close();}
});
test('real admin guard/API, CSRF, invalid bodies, private and AI isolation, bounded image uploads and edit reload',async()=>{
 const f=await fixture();try{
  const req=(path,method='GET',body,user='admin',origin='https://fixture.test')=>new Request('https://fixture.test/api/admin/questions/proofread'+path,{method,headers:{'x-test-user':user,'content-type':'application/json',origin},...(body?{body:JSON.stringify(body)}:{})});
  for(const user of ['', 'a']){assert.equal((await f.route.GET(req('?id=1','GET',null,user))).status,403);assert.equal((await f.route.PATCH(req('','PATCH',{},user))).status,403);}
  for(const id of [0,-1,2147483648])assert.equal((await f.route.GET(req('?id='+id))).status,400);
  assert.equal((await f.route.GET(req('?id=4'))).status,404);const q=await f.detail(1);assert.equal((await f.route.PATCH(req('','PATCH',payload(q),'admin','https://evil.test'))).status,403);
  const forbidden=['question_number','owner_id','question_set_id','kind'];for(const key of forbidden)assert.equal((await f.route.PATCH(req('','PATCH',payload(q,{[key]:'wrong'})))).status,400);
  const beforeAI=await f.query('SELECT * FROM ai_questions');const result=await f.route.PATCH(req('','PATCH',payload(q,{question:'API 保存後重新載入完整題目內容。'})));assert.equal(result.status,200);const reloaded=await(await f.route.GET(req('?id=1'))).json();assert.match(reloaded.question,/API 保存/);assert.deepEqual(await f.query('SELECT * FROM ai_questions'),beforeAI);
  await f.query("INSERT INTO questions(question_set_id,kind,question_number,question) VALUES(1,'ai',99,'must not edit') RETURNING id").then(async rows=>assert.equal((await f.route.GET(req('?id='+rows[0].id))).status,404));
  const overflow=payload(reloaded,{explanation:'x'.repeat(input.PROOF_BODY_LIMIT)});assert.equal((await f.route.PATCH(req('','PATCH',overflow))).status,413);
 }finally{await f.close();}
});
test('deterministic anomaly checks and strict validation never guess or call AI',()=>{
 const q={question:'短',options:['甲','甲','','丁','E'],answer:'F',explanation:'正確答案：B'};const issues=input.questionIssues(q);for(const word of ['截斷','有效答案','E','空白','重複','不一致'])assert(issues.some(i=>i.includes(word)));
 assert(input.questionIssues({...q,answer:'E',options:['a','b']}).some(i=>i.includes('不存在')));
 assert.throws(()=>input.proofInput({action:'save',id:1,revision:'a'.repeat(64),requestId:randomUUID(),question:'題幹內容',options:['a',''],answer:'A',explanation:'',images:[]}));
 const code=readFileSync(new URL('../lib/question-proofreading.ts',import.meta.url),'utf8');assert(!/fetch\(|openai|DELETE FROM|INSERT INTO questions\b/.test(code));
});

test('public statistics expose only version notice; untouched questions retain old response, changed five-choice questions remain single-choice',async()=>{
 const f=await fixture();try{
  const sql=(parts,...values)=>f.query(parts.map((part,i)=>part+(i<values.length?'$'+(i+1):'')).join(''),values);sql.query=f.query;
  const mocks={'@neondatabase/serverless':{neon:()=>sql},'next/server':{NextResponse:Response},'@/lib/question-stats':stats,'@/lib/question-difficulty':load('lib/question-difficulty.ts')};
  const distribution=load('app/api/stats/option-distribution/route.ts',mocks),difficulty=load('app/api/stats/difficulty/route.ts',mocks);
  let q=await f.detail(1);await f.save(payload(q,{options:[...q.options,'第五個正式選項'],answer:['A','E']}));
  for(const route of [distribution,difficulty]){
   const changed=await(await route.GET(new Request('https://fixture.test/api?questionId=1'))).json();assert.equal(changed.historyNotice,true);assert(!JSON.stringify(changed).includes('actor_id'));
   const original=await(await route.GET(new Request('https://fixture.test/api?questionId=2'))).json();assert.equal(original.historyNotice,undefined);
   assert.equal((await route.GET(new Request('https://fixture.test/api?questionId=4'))).status,404);
  }
  await stats.recordFirstAnswers(f.query,'a',[{question_id:1,selected_answer:'E'}]);assert.equal((await f.query('SELECT is_correct FROM question_answer_stats WHERE question_id=1'))[0].is_correct,true);
  assert.equal(stats.parseAnswerSubmissions({answers:[{question_id:1,selected_answer:['A','E']}]}),null);
  assert(readFileSync(new URL('../app/api/quiz/route.ts',import.meta.url),'utf8').includes('...(q.option_e?.trim() ? [q.option_e] : [])'));
 }finally{await f.close();}
});
