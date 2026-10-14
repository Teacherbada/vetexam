import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixture,answers,years,stats,learning,coach,detail,input,adminService,batches,load} from './helpers/multiple-answers-fixture.mjs';

test('requested cases 1–7, canonical arrays, duplicates/empty members and invalid answers',()=>{
 for(const [key,selected,expected] of [['A','A',true],['A','B',false],[['A','B'],'A',true],[['A','B'],'B',true],[['A','B'],'C',false],['C','C',true]]) assert.equal(answers.isCorrectAnswer(key,selected),expected);
 assert.equal(answers.importedAnswer('D',['a','b','c','d']),'D');
 assert.equal(answers.serializeAnswer(['A','','A',null,'B']),'["A","B"]');
 assert.equal(answers.serializeAnswer('A、B、D'),'["A","B","D"]');
 for(const invalid of ['Z','E','AB','A,Z',['A','Z'],['A',5],[],{}])assert.equal(answers.serializeAnswer(invalid),null);
 assert.equal(answers.usableAnswer({answer:['A','B'],options:['a','','c','d']}),null);
 assert.equal(answers.importedAnswer('A',[123,'b','c','d']),null);
 assert.equal(answers.formatAnswer('["A","B"]'),'A、B');
 const parsed=input.parseInput({question_set_id:1,mode:'single',question_id:2,answer:['B','A','A']});assert.equal(parsed.answer,'["A","B"]');
 assert.deepEqual(input.parseEntries(input.parseInput({question_set_id:1,mode:'table',text:'1 A\n2 A、B\n3 ["A","B","D"]'}),[]).entries.map(x=>x.answer),['A','["A","B"]','["A","B","D"]']);
 assert(input.parseEntries(input.parseInput({question_set_id:1,mode:'sequence',text:'A、B'}),[]).errors.length);
});

test('migration is idempotent, preserves records, parses legacy/new keys and retains single-choice response constraint',async()=>{
 const f=await fixture();try{
  const before=await f.query('SELECT * FROM questions ORDER BY id');
  await f.db.exec(readFileSync(new URL('../migrations/20261014_multiple_official_answers.sql',import.meta.url),'utf8'));
  assert.deepEqual(await f.query('SELECT * FROM questions ORDER BY id'),before);
  for(const key of ['A','C','E','["A","B"]','["A","B","D"]','["B","A","A"]'])assert.deepEqual((await f.query('SELECT vetexam_answer_keys($1) AS keys',[key]))[0].keys,answers.answerKeys(key));
  for(const key of ['Z','AB','["A","F"]','{}','[1]'])assert.deepEqual((await f.query('SELECT vetexam_answer_keys($1) AS keys',[key]))[0].keys,[]);
  const id=await f.transaction(tx=>coach.createDiagnosticSession(tx,'a',[{id:2,subject:'獸醫病理學',chapter:null}]));
  assert.equal((await f.query('SELECT answer_key FROM diagnostic_items WHERE session_id=$1',[id]))[0].answer_key,'["A","B"]');
  await assert.rejects(f.db.query("UPDATE diagnostic_items SET selected_answer='AB',is_correct=true,answered_at=now() WHERE session_id=$1",[id]));
 }finally{await f.close();}
});

test('statistics/detail API/learning history and memory accept either official answer; private/AI records unaffected',async()=>{
 const f=await fixture();try{
  const ai=await f.query('SELECT * FROM ai_questions');
  for(const [user,letter,correct] of [['a','A',true],['b','B',true],['c','C',false]]){
   const result=await f.transaction(tx=>detail.answerPublicQuestion(tx,user,{question_id:2,selected_answer:letter}));assert.equal(result.body.correct,correct);
   await f.transaction(tx=>learning.recordPractice(tx,user,[{question_id:2,selected_answer:letter,event_id:randomUUID()}],'practice'));
   assert.equal((await f.query('SELECT is_correct FROM question_answer_stats WHERE user_id=$1 AND question_id=2',[user]))[0].is_correct,correct);
   assert.equal((await f.query('SELECT is_correct FROM practice_attempts WHERE user_id=$1',[user]))[0].is_correct,correct);
   assert.equal((await f.query('SELECT reps FROM question_memory_state WHERE user_id=$1',[user]))[0].reps,1);
  }
  await stats.recordFirstAnswers(f.query,'a',[{question_id:4,selected_answer:'D'}]);assert.equal((await f.query('SELECT * FROM question_answer_stats WHERE question_id=4')).length,0);
  assert.deepEqual(await f.query('SELECT * FROM ai_questions'),ai);
  const review=await f.transaction(tx=>learning.readLearning(tx,'c'));assert(review.wrongQuestions.some(q=>q.id===2));
  const good=await f.transaction(tx=>learning.readLearning(tx,'b'));assert(!good.wrongQuestions.some(q=>q.id===2));
 }finally{await f.close();}
});

test('coach initial/daily/custom snapshots and result scoring retain the same selection and completion rules',async()=>{
 const f=await fixture();try{
  assert((await f.transaction(tx=>coach.diagnosticCandidates(tx,'a'))).some(q=>q.id===2));
  for(const [user,kind,letter,expected] of [['a','initial','A',true],['b','daily','B',true],['c','custom','C',false]]){
   if(kind==='custom')await f.db.query("UPDATE study_plans SET mode='custom' WHERE user_id=$1",[user]);
   const id=await f.transaction(tx=>coach.createDiagnosticSession(tx,user,[{id:2,subject:'獸醫病理學',chapter:null}],kind));
   await f.transaction(tx=>coach.answerDiagnostic(tx,user,{sessionId:id,position:1,answer:letter},kind));
   const [q]=await f.query('SELECT * FROM diagnostic_items WHERE session_id=$1',[id]);assert.equal(q.is_correct,expected);assert.equal(q.selected_answer,letter);
   assert((await f.query('SELECT completed_at FROM diagnostic_sessions WHERE id=$1',[id]))[0].completed_at);
  }
 }finally{await f.close();}
});

test('admin answer edit preview and existing first-answer recalculation use set membership',async()=>{
 const f=await fixture();try{
  await stats.recordFirstAnswers(f.query,'a',[{question_id:1,selected_answer:'B'}]);
  const value=input.parseInput({question_set_id:1,mode:'single',question_id:1,answer:['A','B']});
  const preview=await adminService.buildPreview(f.query,value);assert(preview.can_apply);
  const token=adminService.issuePreviewToken(preview.fingerprint,'admin');
  await f.transaction(tx=>adminService.applyAnswers(tx,value,token,'admin',true,false));
  assert.equal((await f.query('SELECT answer FROM questions WHERE id=1'))[0].answer,'["A","B"]');
  assert.equal((await f.query('SELECT is_correct FROM question_answer_stats WHERE user_id=$1',['a']))[0].is_correct,true);
 }finally{await f.close();}
});

test('ROC years 90/100/105/106/115 and legacy Gregorian values; illegal boundaries rejected',()=>{
 for(const roc of [90,100,105,106,115]){assert(years.examRocYears().includes(roc));assert.equal(years.normalizeExamYear(roc),roc+1911);assert.equal(years.normalizeExamYear(roc+1911),roc+1911);}
 for(const invalid of [89,2000,999,0,-1,'abc','',90.5,years.latestExamRocYear()+1])assert.equal(years.normalizeExamYear(invalid),null);
});

test('real manual/JSON, question-set and legacy PDF confirmation APIs save old/new answers and all requested years',async()=>{
 const f=await fixture();try{
  for(const [name,route]of Object.entries(f.routes))for(const roc of [115,106,105,100,90]){
   const body={name:'Fixture',filename:'fixture.pdf',fileHash:randomUUID(),visibility:'public',examSubject:'獸醫病理學',examYear:roc,questions:[{id:1,question:'fixture',options:['a','b','c','d'],answer:roc===115?'D':['A','B'],explanation:''}]};
   const req=new Request('http://localhost/api/'+name,{method:'POST',headers:{'content-type':'application/json','x-test-user':'admin'},body:JSON.stringify(body)});
   const response=await route.POST(req),data=await response.json();assert.equal(response.status,200,JSON.stringify(data));
   const rows=await f.query('SELECT q.answer,qs.exam_year FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id WHERE qs.id=$1',[data.questionSetId]);assert.equal(rows.length,1,name);assert.equal(rows[0].exam_year,roc+1911);assert.equal(rows[0].answer,roc===115?'D':'["A","B"]');
  }
  for(const bad of [{examYear:89},{questions:[{question:'x',options:['a','b','c','d'],answer:['A','Z']}]}]){
   const body={name:'bad',filename:'bad.pdf',fileHash:randomUUID(),visibility:'public',examSubject:'獸醫病理學',examYear:90,questions:[{question:'x',options:['a','b','c','d'],answer:'A'}],...bad};
   for(const route of Object.values(f.routes))assert.equal((await route.POST(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json','x-test-user':'admin'},body:JSON.stringify(body)}))).status,400);
  }
 }finally{await f.close();}
});

test('PDF parser, batch import and replay preserve multiple answers, images and ROC years',async()=>{
 const f=await fixture();try{
  const layout=load('lib/pdf-layout.ts');const lines=['1. Question','A. One','B. Two','C. Three','D. Four','答案：A、B'].map((text,i)=>({text,x:10,top:i*25,bottom:i*25+12}));
  assert.equal(layout.parsePdfLayout([{page:1,width:600,height:800,lines,images:[]}])[0].answer,'["A","B"]');
  const payload={importId:randomUUID(),filename:'batch.pdf',fileHash:'d'.repeat(64),examSubject:'獸醫病理學',examYear:90,visibility:'public',totalQuestions:1,batchIndex:0,ranges:[{from:1,to:1}],questions:[{question:'new',options:['a','b','c','d'],answer:['B','A','A'],explanation:'saved',imageDataUrl:'data:image/png;base64,YQ=='}]};
  const parsed=batches.parseImportBatch(payload);assert.equal(parsed.questions[0].answer,'["A","B"]');
  const result=await f.transaction(tx=>batches.saveImportBatch(tx,'admin',true,parsed));
  const repeat=await f.transaction(tx=>batches.saveImportBatch(tx,'admin',true,parsed));assert.equal(repeat.questionSetId,result.questionSetId);
  const [q]=await f.query('SELECT * FROM questions WHERE question_set_id=$1',[result.questionSetId]);assert.equal(q.answer,'["A","B"]');assert.equal(q.image_data_url,payload.questions[0].imageDataUrl);
 }finally{await f.close();}
});

test('featured explanation import matches the complete answer set, never just one accepted letter',async()=>{
 const f=await fixture();try{
  const official=load('lib/official-explanation.ts',{'./admin-question-input':input,'./admin-questions':adminService});
  const batch=load('lib/featured-explanation-import.ts',{'./admin-question-input':input,'./admin-questions':adminService,'./official-explanation':official,'./featured-explanation-import-input':load('lib/featured-explanation-import-input.ts')});
  const preview=async expectedAnswer=>batch.previewImport(f.query,batch.parseImport({explanations:[{questionId:2,expectedAnswer,explanation:'Fixture only'}]}),'admin');
  assert.equal((await preview(['B','A'])).rows[0].category,'ready');
  assert.equal((await preview('A')).rows[0].category,'answer_mismatch');
  assert.equal((await preview(['A','C'])).rows[0].category,'answer_mismatch');
 }finally{await f.close();}
});
