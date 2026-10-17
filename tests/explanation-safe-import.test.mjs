import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {importFixture,handoff,selections,safeImport} from './helpers/featured-explanation-import-fixture.mjs';
import {service} from './helpers/official-explanation-fixture.mjs';
const sample=JSON.parse(readFileSync(new URL('../public/examples/explanation-handoff.example.json',import.meta.url),'utf8')).explanations[0];
async function prepared(f){
 const data=await handoff.exportQuestions(f.sql.query,new URLSearchParams('questionSetId=1&afterId=9&limit=10'));
 const input={formatVersion:'vetexam-explanations-v1',explanations:data.questions.map(q=>({...structuredClone(sample),questionId:q.questionId,questionFingerprint:q.questionFingerprint,sourceFingerprint:q.sourceFingerprint,expectedAnswers:q.officialAnswers,optionExplanations:Object.fromEntries(Object.entries(q.options).filter(([,v])=>v?.trim()).map(([k])=>[k,'Synthetic independent reasoning '+k])),references:[{...sample.references[0],supports:['correctAnswerReason']}],doubts:[]}))};
 const p=await f.call({action:'preview',input});assert.equal(p.status,200);assert.equal(p.data.rows.filter(r=>r.category==='ready').length,10);
 return {action:'import',input,selected:selections(p.data),requestId:randomUUID()};
}
async function edit(f,id,action,extra={}){const s=await service.readExplanation(f.sql.query,id);return f.save({id,revision:s.revision,explanation:s.explanation,action,confirmReview:true,...extra});}
const bodySnapshot=f=>f.sql.query("SELECT jsonb_agg(to_jsonb(q)-'explanation'-'explanation_status'-'explanation_version'-'explanation_binding' ORDER BY id) AS data FROM questions q",[]);

test('10 structured drafts, durable receipts, response-lost replay, concurrent requests and actor-only retrieval',async()=>{
 const f=await importFixture();try{
  await f.db.exec(`UPDATE questions SET option_e='E choice',answer='["A","E"]' WHERE id=10; UPDATE questions SET answer='["A","B"]' WHERE id=11`);
  const before=await bodySnapshot(f),req=await prepared(f);
  const results=await Promise.all([f.call(req),f.call(req)]);assert(results.every(r=>r.status===200),JSON.stringify(results));
  assert.equal(results.filter(r=>r.data.replayed).length,1);assert.equal(results[0].data.success,10);
  assert((await f.sql.query('SELECT explanation_version,explanation_status,explanation_binding FROM questions WHERE id BETWEEN 10 AND 19',[])).every(q=>q.explanation_version===1&&q.explanation_status==='draft'&&q.explanation_binding.reviewStatus==='pending_review'));
  const retry=await f.call(req);assert(retry.data.replayed);assert.equal(retry.data.receiptId,req.requestId);
  const get=(id,user)=>f.batchRoute.GET(new Request('http://localhost/api/admin/questions/explanation/import'+(id?'?receiptId='+id:''),{headers:{'x-fixture-user':user}}));
  assert.equal((await get(req.requestId,'member')).status,403);assert.equal((await get(req.requestId,'fixture-admin')).status,200);
  assert.equal((await (await get('','fixture-admin')).json()).receipts.length,1);
  await assert.rejects(()=>safeImport.readImportReceipt(f.sql.query,'other-admin',req.requestId),/找不到/);
  const changed=structuredClone(req);changed.input.explanations[0].coreConcept+=' changed';assert.equal((await f.call(changed)).status,409);
  const duplicate=await f.call({...req,requestId:randomUUID()});assert.equal(duplicate.data.skipped,10);assert.equal(duplicate.data.success,0);
  assert.deepEqual(await bodySnapshot(f),before);
  await f.db.exec("UPDATE questions SET image_data_url='invalid changed source' WHERE id=10");
  assert.equal((await f.call(req)).data.replayed,true,'receipt replay must not reread changed images');
 }finally{await f.close();}
});

test('additive migration preserves all existing data/status and is repeatable; DDL transaction can roll back',async()=>{
 const f=await importFixture();try{
  const migration=readFileSync(new URL('../migrations/20261018_explanation_handoff_safety.sql',import.meta.url),'utf8');
  const before=await f.sql.query('SELECT * FROM questions ORDER BY id',[]);
  await f.db.exec(migration);assert.deepEqual(await f.sql.query('SELECT * FROM questions ORDER BY id',[]),before);
  await assert.rejects(f.db.transaction(async tx=>{await tx.exec(migration);await tx.exec("UPDATE questions SET explanation='rollback fixture' WHERE id=10");throw Error('rollback migration');}),/rollback migration/);
  assert.deepEqual(await f.sql.query('SELECT * FROM questions ORDER BY id',[]),before);
 }finally{await f.close();}
});

test('server rechecks all sources, answer sets and entire structured input after preview; partial result is explicit',async()=>{
 const f=await importFixture();try{
  const req=await prepared(f);await f.db.exec("UPDATE questions SET answer='A' WHERE id=10; UPDATE questions SET explanation='another admin draft' WHERE id=11; UPDATE questions SET option_e='new E' WHERE id=12");
  req.input.explanations[3].coreConcept+=' tampered';
  const r=await f.call(req);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.data.success,6);assert.equal(r.data.failed,3);assert.equal(r.data.skipped,1);
  assert.equal((await service.readExplanation(f.sql.query,11)).explanation,'another admin draft');
  assert.equal((await service.readExplanation(f.sql.query,13)).status,'unwritten');
 }finally{await f.close();}
});

test('draft publication, withdrawal and re-review preserve question/answer/image data; source edits invalidate publication',async()=>{
 const f=await importFixture();try{
  assert.equal((await f.call(await prepared(f))).data.success,10);
  const before=await bodySnapshot(f),s=await service.readExplanation(f.sql.query,10);
  const published=await edit(f,10,'publish');assert.equal(published.status,'published');
  const withdrawn=await edit(f,10,'unpublish',{explanation:'must not replace'});assert.equal(withdrawn.status,'draft');assert.equal(withdrawn.explanation,s.explanation);
  await edit(f,10,'publish');assert.deepEqual(await bodySnapshot(f),before);
  const old=await service.readExplanation(f.sql.query,10);
  await f.db.exec("UPDATE questions SET answer='A' WHERE id=10");
  const stale=await service.readExplanation(f.sql.query,10);assert.equal(stale.status,'draft');assert.equal(stale.sourceChanged,true);
  await assert.rejects(()=>edit(f,10,'publish'),/版本已變更/);
  await assert.rejects(()=>f.save({id:10,explanation:old.explanation,revision:old.revision,action:'publish',confirmReview:true}),/其他操作更新/);
  await edit(f,10,'draft');assert.equal((await service.readExplanation(f.sql.query,10)).sourceChanged,true);
  await edit(f,10,'draft',{confirmSourceReview:true});assert.equal((await service.readExplanation(f.sql.query,10)).sourceChanged,false);
  await edit(f,10,'publish');
  await f.db.exec("UPDATE question_sets SET file_hash='official-correction-2' WHERE id=1");assert.equal((await service.readExplanation(f.sql.query,10)).status,'draft');
  await assert.rejects(()=>edit(f,10,'publish'),/版本已變更/);
  await edit(f,10,'draft',{confirmSourceReview:true});await edit(f,10,'publish');
  await f.db.exec("INSERT INTO question_proofreading(question_id,images,image_fingerprint) VALUES(10,'[]','new-image-version')");
  assert.equal((await service.readExplanation(f.sql.query,10)).status,'draft');
  await assert.rejects(()=>f.db.exec("UPDATE questions SET explanation_status='published' WHERE id=10"),/source changed/);
  assert((await f.sql.query('SELECT count(*)::int AS count FROM explanation_review_events WHERE question_id=10',[]))[0].count>=8);
  assert.equal((await f.sql.query('SELECT selected_answer FROM question_answer_stats WHERE id=1',[]))[0].selected_answer,'A');
 }finally{await f.close();}
});

test('transaction failure rolls back both receipt and drafts; same request safely succeeds after recovery',async()=>{
 const f=await importFixture();try{
  const req=await prepared(f);
  await f.db.exec(`CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic final receipt failure'; END $$;
    CREATE TRIGGER fail_receipt BEFORE UPDATE ON explanation_import_receipts FOR EACH ROW EXECUTE FUNCTION fail_receipt();`);
  assert.equal((await f.call(req)).status,503);
  assert.equal((await f.sql.query('SELECT count(*)::int AS count FROM explanation_import_receipts',[]))[0].count,0);
  for(let id=10;id<20;id++)assert.equal((await service.readExplanation(f.sql.query,id)).status,'unwritten');
  await f.db.exec('DROP TRIGGER fail_receipt ON explanation_import_receipts');assert.equal((await f.call(req)).data.success,10);
 }finally{await f.close();}
});
