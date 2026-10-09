import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';
import pg from 'pg';
import nextEnv from '@next/env';
import { diagnosticTestConnectionString } from './diagnostic-database.mjs';
import { makePDF,sourceText } from './ai-material-fixtures.mjs';
const require=createRequire(import.meta.url);
function load(path,mocks={}) {
  const exports={}; const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports',code)(name=>{if(name==='server-only')return {};if(name in mocks)return mocks[name];if(name.startsWith('node:'))return require(name);if(name==='pdfjs-dist/legacy/build/pdf.mjs')return import(name);throw Error('Unexpected import '+name);},exports);return exports;
}
const taxonomy=load('data/exam-chapters.ts');
const input=load('lib/ai-question-input.ts',{'@/data/exam-chapters':taxonomy});
const materials=load('lib/ai-material-input.ts',{'@/data/exam-chapters':taxonomy,'./ai-question-input':input});
const signing=load('lib/admin-questions.ts',{'./admin-question-input':load('lib/admin-question-input.ts')});
const questions=load('lib/ai-question-service.ts',{'./ai-question-input':input,'./admin-questions':signing});
const model=load('lib/ai-material-model.ts',{'./ai-material-input':materials});
const pdf=load('lib/ai-material-pdf.ts',{'./ai-material-input':materials});
const httpBase=load('lib/admin-question-http.ts',{'next/server':{NextResponse:{json:(b,i)=>Response.json(b,i)}},'./admin-questions':signing});
const http=load('lib/ai-question-http.ts',{'./admin-questions':signing,'./admin-question-http':httpBase});
const pages=[{page:1,text:sourceText,hash:'page-one-hash',usable:true,visual:false,warning:''},{page:2,text:'',hash:'page-two-hash',usable:false,visual:true,warning:'OCR'}];
const spec={materialId:randomUUID(),title:'Synthetic teaching PDF',edition:'',subject:'獸醫公共衛生學',chapter:'獸醫流行病學',sourceChapter:'',start:1,end:1,count:3,difficulty:'基礎',printedPages:{}};
const result={status:'generated',reason:'',question:'在 100 隻動物中有 2 隻符合病例定義，其比例為何？',options:['2%','20%','0.2%','50%'],answer:'A',explanation:'2 除以 100 為 0.02，亦即 2%；其餘數值不符此計算。',optionExplanations:['','','',''],pdfPage:1,excerpt:'A survey includes 100 animals. Two animals meet the case definition. The proportion is 2 divided by 100, or 2 percent.'};
function service(tx={questionTransaction:()=>{throw Error('unexpected transaction');}}) {return load('lib/ai-material-service.ts',{'./question-transaction':tx,'./admin-questions':signing,'./ai-question-input':input,'./ai-question-service':questions,'./ai-material-input':materials,'./ai-material-model':model});}
test('selection uses official taxonomy, usable extracted pages, fixed cost/token/count limits',()=>{
  assert.equal(materials.parseMaterialSpec(spec,pages).count,3);
  for(const patch of [{count:11},{count:0},{start:0},{end:3},{end:2},{subject:'invented'},{chapter:''},{difficulty:'expert'}])assert.throws(()=>materials.parseMaterialSpec({...spec,...patch},pages));
  assert.throws(()=>materials.parseMaterialSpec(spec,[{...pages[0],text:'字'.repeat(6100)}]),/18 KB/);
  assert(materials.MATERIAL_LIMITS.perQuestionMicroUSD*10<=materials.MATERIAL_LIMITS.batchMicroUSD);
  const body=model.materialModelRequest(spec,pages,[],1);assert.equal(body.model,'gpt-4.1-mini-2025-04-14');assert.equal(body.store,false);assert.equal(body.max_output_tokens,2400);assert(!('tools' in body));assert(!body.input.includes('page-two-hash'));
  assert.throws(()=>model.materialModelRequest(spec,[{...pages[0],text:'a'.repeat(33000)}],[],1),/輸入上限/);
});
test('source pages and quotes must match persisted extraction; printed pages never guessed',()=>{
  const q=materials.generatedQuestion(result,spec,pages);assert.equal(q.question.source.pdfPages,'1');assert.equal(q.question.source.printedPages,'');assert.equal(q.question.source.url,'');assert.equal(q.pageHash,pages[0].hash);
  for(const patch of [{pdfPage:2},{pdfPage:9},{excerpt:'Invented supporting passage that is not in this PDF.'},{status:'insufficient'},{answer:'AB'}])assert.throws(()=>materials.generatedQuestion({...result,...patch},spec,pages));
});
test('real PDF extraction retains indices, detects blank/scanned and vector pages, rejects malformed/large PDFs',async()=>{
  const extracted=await pdf.extractMaterialPDF(new Uint8Array(makePDF([sourceText,''],true)));
  assert.equal(extracted.length,2);assert.equal(extracted[0].page,1);assert(extracted[0].usable);assert(extracted[0].visual);assert(extracted[0].text.includes('100 animals'));assert.equal(extracted[1].page,2);assert(!extracted[1].usable);assert(extracted[1].warning.includes('OCR'));assert.match(extracted[0].hash,/^[a-f0-9]{64}$/);
  await assert.rejects(pdf.extractMaterialPDF(new Uint8Array(Buffer.from('not pdf'))));
  await assert.rejects(pdf.extractMaterialPDF(new Uint8Array(3*1024*1024+1)));
});
test('model network errors are never retried; missing key invokes no network; schema output is parsed',async()=>{
  const oldFetch=globalThis.fetch, oldKey=process.env.OPENAI_API_KEY;let calls=0;
  try {
    delete process.env.OPENAI_API_KEY;globalThis.fetch=async()=>{calls++;throw Error('should not call');};
    await assert.rejects(model.callMaterialModel(model.materialModelRequest(spec,pages,[],1)),/OPENAI_API_KEY/);assert.equal(calls,0);
    process.env.OPENAI_API_KEY='test-not-a-real-key';globalThis.fetch=async(_url,init)=>{calls++;const body=JSON.parse(init.body);assert(!body.tools);return Response.json({error:'fixture'},{status:429});};
    await assert.rejects(model.callMaterialModel(model.materialModelRequest(spec,pages,[],1)),/429/);assert.equal(calls,1);
    globalThis.fetch=async()=>Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}],usage:{input_tokens:1000,output_tokens:200}});
    const response=await model.callMaterialModel(model.materialModelRequest(spec,pages,[],1));assert.deepEqual(response.value,result);assert.equal(response.actual,720);
  }finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
test('every material API operation denies guest/member before processing PDF, database or AI',async()=>{
  let calls=0;
  const route=load('app/api/admin/ai-materials/route.ts',{'@/lib/admin':{requireAdmin:async()=>null},'@/lib/question-transaction':{questionTransaction:()=>{calls++;}},'@/lib/admin-questions':signing,'@/lib/ai-question-http':http,'@/lib/ai-question-input':input,'@/lib/ai-material-input':materials,'@/lib/ai-material-pdf':{extractMaterialPDF:()=>{calls++;}},'@/lib/ai-material-service':{}});
  for(const query of ['','?material='+spec.materialId,'?material='+spec.materialId+'&pdf=1','?job='+randomUUID()])assert.equal((await route.GET(new Request('https://vetexam.test/api/admin/ai-materials'+query))).status,403);
  for(const action of ['estimate','start','step'])assert.equal((await route.POST(new Request('https://vetexam.test/api/admin/ai-materials',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})}))).status,403);
  const form=new FormData();form.append('file',new File([makePDF([sourceText])],'fixture.pdf'));assert.equal((await route.POST(new Request('https://vetexam.test/api/admin/ai-materials',{method:'POST',body:form}))).status,403);assert.equal(calls,0);
});
test('admin upload extracts real PDF without invoking AI; cross-origin and oversized files fail before extraction',async()=>{
  let extracted=0,saved=0,aiCalls=0;
  const route=load('app/api/admin/ai-materials/route.ts',{'@/lib/admin':{requireAdmin:async()=>({session:{user:{id:'admin'}}})},'@/lib/question-transaction':{questionTransaction:run=>run({})},'@/lib/admin-questions':signing,'@/lib/ai-question-http':http,'@/lib/ai-question-input':input,'@/lib/ai-material-input':materials,'@/lib/ai-material-pdf':{extractMaterialPDF:async bytes=>{extracted++;return pdf.extractMaterialPDF(bytes);}},'@/lib/ai-material-service':{saveMaterial:async(_c,_b,_n,extraction)=>{saved++;return {id:spec.materialId,pages:extraction};},startMaterialJob:()=>{aiCalls++;},stepMaterialJob:()=>{aiCalls++;}}});
  const request=(bytes,origin='https://vetexam.test')=>{const form=new FormData();form.append('file',new File([bytes],'fixture.pdf'));return new Request('https://vetexam.test/api/admin/ai-materials',{method:'POST',headers:{origin},body:form});};
  assert.equal((await route.POST(request(makePDF([sourceText]),'https://evil.test'))).status,403);assert.equal(extracted,0);
  assert.equal((await route.POST(request(new Uint8Array(3*1024*1024+1)))).status,400);assert.equal(extracted,0);
  const response=await route.POST(request(makePDF([sourceText])));assert.equal(response.status,200);assert((await response.json()).material.pages[0].usable);assert.equal(extracted,1);assert.equal(saved,1);assert.equal(aiCalls,0);
  const missingKey=process.env.OPENAI_API_KEY;
  try{delete process.env.OPENAI_API_KEY;await assert.rejects(service().startMaterialJob({}, {},'admin'),/OPENAI_API_KEY/);}finally{if(missingKey!==undefined)process.env.OPENAI_API_KEY=missingKey;}
});
test('PostgreSQL: persistent claims, dedup, partial failure/resume, source review, batch publication and tombstones', {skip:process.env.AI_QUESTIONS_DB_TEST!=='1'},async()=>{
  nextEnv.loadEnvConfig(process.cwd()); const client=new pg.Client({connectionString:diagnosticTestConnectionString(),connectionTimeoutMillis:10000});await client.connect();
  const oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-only';const svc=service();
  try {
    const schema='ai_material_test_'+randomUUID().replaceAll('-','');await client.query('BEGIN');await client.query('CREATE SCHEMA '+schema);await client.query('SET LOCAL search_path TO '+schema);
    for(const file of ['20261009_ai_question_bank.sql','20261010_ai_material_generation.sql','20261010_ai_material_generation.sql'])await client.query(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
    const material=await svc.saveMaterial(client,makePDF([sourceText]),'fixture.pdf',pages,'admin');assert.equal((await svc.saveMaterial(client,makePDF([sourceText]),'fixture.pdf',pages,'admin')).id,material.id);
    const selected={...spec,materialId:material.id};const estimate=await svc.estimateMaterial(client,selected);assert.equal(estimate.cost,49920);
    const body={requestKey:randomUUID(),spec:selected,confirmText:true,confirmCost:true,estimateMicroUSD:estimate.cost};
    await assert.rejects(svc.startMaterialJob(client,{...body,confirmText:false},'admin'),/確認/);
    const job=await svc.startMaterialJob(client,body,'admin');assert.equal((await svc.startMaterialJob(client,body,'admin')).jobId,job.jobId);assert.equal((await svc.startMaterialJob(client,{...body,requestKey:randomUUID()},'admin')).jobId,job.jobId);
    await assert.rejects(svc.startMaterialJob(client,{...body,spec:{...selected,title:'changed'}},'admin'),/其他設定/);
    const claim=await svc.claimMaterialItem(client,job.jobId);assert.equal(claim.position,1);assert.equal((await svc.claimMaterialItem(client,job.jobId)).stopped,true);
    assert.equal((await svc.finishMaterialItem(client,claim,{value:result,usage:{input_tokens:1000,output_tokens:200},actual:720})).stopped,false);
    await svc.finishMaterialItem(client,claim,{value:result,usage:null,actual:null}); // Result replay cannot duplicate a question.
    const query=async(sql,values)=>(await client.query(sql,values)).rows;
    let rows=await query('SELECT * FROM ai_questions',[]);assert.equal(rows.length,1);assert.equal(rows[0].status,'draft');assert.equal((await questions.listPublishedAI(query,'','','')).length,0);
    const second=await svc.claimMaterialItem(client,job.jobId);assert.equal(second.position,2);await svc.finishMaterialItem(client,second,null,'fixture network failure');
    assert.equal((await query('SELECT * FROM ai_questions',[])).length,1);
    const third=await svc.claimMaterialItem(client,job.jobId);assert.equal(third.position,3);await client.query("UPDATE ai_generation_items SET started_at=now()-interval '100 seconds' WHERE job_id=$1 AND position=3",[job.jobId]);assert.equal((await svc.claimMaterialItem(client,job.jobId)).stopped,true);assert.equal((await query('SELECT status FROM ai_generation_items WHERE position=3',[]))[0].status,'uncertain');assert.equal((await svc.claimMaterialItem(client,job.jobId)).stopped,true);
    let row=rows[0];await assert.rejects(questions.updateAI(client,{action:'save',id:row.id,revision:row.revision,content:{...row.content,source:{...row.content.source,pdfPages:'99'}}},'admin'),/教材來源/);
    await questions.publishAIBatch(client,{questions:[{id:row.id,revision:row.revision}],confirmReview:true},'admin');row=(await query('SELECT * FROM ai_questions',[]))[0];assert.equal(row.review_status,'approved');assert.equal((await questions.listPublishedAI(query,'','','')).length,1);
    await questions.answerAI(client,{id:row.id,revision:row.revision,answer:'A',requestKey:randomUUID()},'member');const snapshot=(await query('SELECT * FROM ai_question_attempts',[]))[0];
    row=await questions.updateAI(client,{action:'save',id:row.id,revision:row.revision,content:{...row.content,explanation:row.content.explanation+' 人工確認計算。'}},'admin');assert.equal(row.status,'draft');
    await questions.updateAI(client,{action:'delete',id:row.id,revision:row.revision,confirmDelete:true},'admin');assert.equal((await questions.listPublishedAI(query,'','','')).length,0);assert.deepEqual((await query('SELECT * FROM ai_question_attempts',[]))[0],snapshot);
    await assert.rejects(questions.updateAI(client,{action:'publish',id:row.id,revision:row.revision+1,confirmReview:true},'admin'),/找不到/);
    // The daily ledger includes uncertain and failed calls, never refunds/replays them.
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM ai_generation_items WHERE started_at IS NOT NULL',[]))[0].n,3);
    const nextBody={...body,requestKey:randomUUID(),spec:{...selected,title:'second batch'}};
    const budgetClient={query:async(sql,values)=>sql.includes('COALESCE(SUM(reserved_micro_usd),0)')?{rows:[{cost:2000000}]}:client.query(sql,values)};
    await assert.rejects(svc.startMaterialJob(budgetClient,nextBody,'admin'),/24 小時/);
    const nextJob=await svc.startMaterialJob(client,nextBody,'admin');
    await assert.rejects(svc.claimMaterialItem(budgetClient,nextJob.jobId),/24 小時/);
    assert.equal((await query('SELECT COUNT(*)::int AS n FROM ai_generation_items WHERE job_id=$1 AND started_at IS NOT NULL',[nextJob.jobId]))[0].n,0);
    // A later optimistic-version conflict must roll back the whole publication batch.
    const extra=await svc.claimMaterialItem(client,nextJob.jobId);
    await svc.finishMaterialItem(client,extra,{value:{...result,question:result.question+'（第二批）'},usage:null,actual:null});
    const draft=(await query('SELECT * FROM ai_questions WHERE deleted_at IS NULL',[]))[0];
    await client.query('SAVEPOINT publish_failure');
    await assert.rejects(questions.publishAIBatch(client,{questions:[{id:draft.id,revision:draft.revision},{id:row.id,revision:row.revision}],confirmReview:true},'admin'));
    await client.query('ROLLBACK TO SAVEPOINT publish_failure');
    assert.equal((await query('SELECT status FROM ai_questions WHERE id=$1',[draft.id]))[0].status,'draft');
  }finally{await client.query('ROLLBACK');await client.end();if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
});
