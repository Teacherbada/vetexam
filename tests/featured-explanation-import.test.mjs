import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { batch, contract, importFixture, item, selections } from './helpers/featured-explanation-import-fixture.mjs';
import { service } from './helpers/official-explanation-fixture.mjs';

test('20 new explanations: preview is read-only, import drafts, reload, replay is harmless; other fields/statistics/AI unchanged', async () => {
  const f=await importFixture();
  try {
    const before=(await f.db.query("SELECT jsonb_agg(to_jsonb(q)-'explanation'-'explanation_status'-'explanation_version' ORDER BY id) AS data FROM questions q")).rows;
    const stats=await f.sql.query('SELECT * FROM question_answer_stats',[]), ai=await f.sql.query('SELECT * FROM ai_questions',[]);
    const input={explanations:Array.from({length:20},(_,i)=>item(i+10, i===0?{sourceReferences:['https://example.test/source']}:{}))};
    const preview=await f.call({action:'preview',input}); assert.equal(preview.status,200);
    assert.equal(preview.data.rows.filter(r=>r.category==='ready').length,20);
    assert.equal((await service.readExplanation(f.sql.query,10)).status,'unwritten');
    const request={action:'import',input,selected:selections(preview.data)};
    const result=await f.call(request); assert.equal(result.status,200);
    assert.deepEqual([result.data.success,result.data.failed,result.data.skipped],[20,0,0]);
    for(let id=10;id<30;id++) {const loaded=await service.readExplanation(f.sql.query,id);assert.equal(loaded.status,'draft'); assert.match(loaded.explanation,/pharmacokinetics/);}
    assert.match((await service.readExplanation(f.sql.query,10)).explanation,/### 參考資料\n- <https:\/\/example.test\/source>/);
    const replay=await f.call(request);assert.deepEqual([replay.data.success,replay.data.failed,replay.data.skipped],[0,0,20]);
    const repeat=await f.call({action:'preview',input});assert(repeat.data.rows.every(r=>r.category==='existing'));
    assert.equal((await f.sql.query('SELECT explanation_version FROM questions WHERE id=10',[]))[0].explanation_version,1);
    assert.deepEqual((await f.db.query("SELECT jsonb_agg(to_jsonb(q)-'explanation'-'explanation_status'-'explanation_version' ORDER BY id) AS data FROM questions q")).rows,before);
    assert.deepEqual(await f.sql.query('SELECT * FROM question_answer_stats',[]),stats);
    assert.deepEqual(await f.sql.query('SELECT * FROM ai_questions',[]),ai);
  } finally {await f.close();}
});

test('published/draft, unknown/private/AI IDs, answer/fingerprint mismatch and duplicate IDs refuse import',async()=>{
  const f=await importFixture();
  try {
    await f.db.exec("UPDATE questions SET explanation='published original',explanation_status='published' WHERE id=10");
    const input={explanations:[item(10),item(2,{expectedAnswer:'B'}),item(999),item(3,{expectedAnswer:'A'}),item(4,{expectedAnswer:'D'}),item(11,{expectedAnswer:'A'}),item(12,{questionFingerprint:'0'.repeat(64)}),item(13),item(13)]};
    const p=await f.call({action:'preview',input});
    assert.deepEqual(p.data.rows.map(r=>r.category),['existing','existing','not_found','not_found','not_found','answer_mismatch','invalid','invalid','invalid']);
    const forced=await f.call({action:'import',input,selected:p.data.rows.map(r=>({index:r.index,token:'invalid'}))});
    assert.equal(forced.data.success,0);assert.equal(forced.data.skipped,2);assert.equal(forced.data.failed,7);
    assert.equal((await service.readExplanation(f.sql.query,10)).explanation,'published original');
    assert.equal((await service.readExplanation(f.sql.query,2)).explanation,'既有解析不能遺失');
  }finally{await f.close();}
});

test('format validation, source URL safety, file/row limits, formal schema and example',()=>{
  for(const input of [{},[],{explanations:[]},{explanations:Array(51).fill(item(10))},{explanations:[item(10)],ownerId:'x'}]) assert.throws(()=>batch.parseImport(input));
  for(const patch of [{questionId:'10'},{expectedAnswer:'c'},{expectedAnswer:'A,C'},{explanation:''},{explanation:'  ',sourceReferences:['https://example.test']},{explanation:null},{explanation:'x'.repeat(20001)},{explanation:'x\0y'},{status:'published'},{kind:'ai'},{questionFingerprint:'abc'},{sourceReferences:['javascript:alert(1)']},{sourceReferences:['https://name:password@example.test']},{sourceReferences:['https://example.test/<script>']},{sourceReferences:['https://']},{sourceReferences:Array(11).fill('https://example.test')},{explanation:'x'.repeat(19990),sourceReferences:['https://example.test']}]) {
    assert.equal(batch.parseImport({explanations:[item(10,patch)]})[0].row.category,'invalid',JSON.stringify(patch).slice(0,100));
  }
  assert.throws(()=>batch.parseImport({explanations:Array.from({length:50},(_,i)=>item(i+1,{explanation:'中'.repeat(19000)}))}),/2 MiB/);
  const schema=JSON.parse(readFileSync(new URL('../public/examples/featured-explanations.schema.json',import.meta.url),'utf8'));
  assert.equal(schema.properties.explanations.maxItems,50);
  const example=JSON.parse(readFileSync(new URL('../public/examples/featured-explanations.example.json',import.meta.url),'utf8'));
  assert.equal(batch.parseImport(example)[0].row.category,'ready');assert.equal(contract.IMPORT_FILE_BYTES,2097152);
});

test('real admin guard, same-origin restriction, malformed and oversized HTTP requests',async()=>{
  const f=await importFixture();try{
    const body={action:'preview',input:{explanations:[item(10)]}};
    for(const user of [null,'member']) for(const action of ['preview','import']) assert.equal((await f.call({...body,action},user)).status,403);
    assert.equal((await f.call(body,'fixture-admin',{origin:'https://evil.test'})).status,403);
    assert.equal((await f.call(body,'fixture-admin',{'sec-fetch-site':'cross-site'})).status,403);
    assert.equal((await f.call(body,'fixture-admin',{'content-type':'text/plain'})).status,415);
    assert.equal((await f.call('{broken')).status,400);
    assert.equal((await f.call('x'.repeat(3*1024*1024+1))).status,413);
    assert.equal((await f.call({...body,ownerId:'bad'})).status,400);
    assert.equal((await f.call(body)).headers.get('cache-control'),'private, no-store');
    assert.equal((await service.readExplanation(f.sql.query,10)).status,'unwritten');
  }finally{await f.close();}
});

test('partial results: changed question, new draft, invalid item and unselected items; signed preview binds content and identity',async()=>{
  const f=await importFixture();try{
    const input={explanations:[item(10),item(11),item(12),item(13),item(999)]};
    const p=(await f.call({action:'preview',input})).data;
    await f.db.exec("UPDATE questions SET question='Changed after preview' WHERE id=11; UPDATE questions SET explanation='New draft',explanation_version=1 WHERE id=12");
    const r=await f.call({action:'import',input,selected:[...selections(p).filter(s=>s.index!==3),{index:4,token:'invalid'}]});
    assert.deepEqual([r.data.success,r.data.failed,r.data.skipped],[1,2,2]);
    assert.equal((await service.readExplanation(f.sql.query,11)).status,'unwritten');assert.equal((await service.readExplanation(f.sql.query,12)).explanation,'New draft');
    const single={explanations:[item(14)]};const a=(await f.call({action:'preview',input:single})).data;
    single.explanations[0].explanation+='tampered';
    assert.equal((await f.call({action:'import',input:single,selected:selections(a)})).data.failed,1);
    const entries=batch.parseImport({explanations:[item(15)]});const other=await batch.previewImport(f.sql.query,entries,'different-admin');
    assert.equal((await f.call({action:'import',input:{explanations:[item(15)]},selected:selections(other)})).data.failed,1);
    assert.throws(()=>batch.parseSelections([{index:0,token:'x'},{index:0,token:'x'}],batch.parseImport(input)));
  }finally{await f.close();}
});

test('optional matching fingerprint works; expiry, visibility and answer changes fail closed',async()=>{
  const f=await importFixture();try{
    const input={explanations:[item(10),item(11),item(12),item(13)]};
    const initial=(await f.call({action:'preview',input})).data;
    input.explanations[0].questionFingerprint=initial.rows[0].questionFingerprint;
    const p=(await f.call({action:'preview',input})).data;
    await f.db.exec("UPDATE questions SET answer='A' WHERE id=11; UPDATE questions SET question_set_id=2 WHERE id=12");
    const original=Date.now;Date.now=()=>original()+16*60*1000;
    try{const expired=await f.call({action:'import',input,selected:[selections(p)[3]]});assert.equal(expired.data.failed,1);}finally{Date.now=original;}
    const r=await f.call({action:'import',input,selected:selections(p).slice(0,3)});
    assert.deepEqual([r.data.success,r.data.failed,r.data.skipped],[1,2,1]);
  }finally{await f.close();}
});

test('database failure rolls back every attempted write with per-row failure results',async()=>{
  const f=await importFixture();try{
    await f.db.exec(`CREATE FUNCTION block_test_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id=11 THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_failure BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION block_test_update();`);
    const input={explanations:[item(10),item(11),item(12)]};
    const p=(await f.call({action:'preview',input})).data;
    const r=await f.call({action:'import',input,selected:selections(p).slice(0,2)});
    assert.equal(r.status,503);assert.deepEqual([r.data.success,r.data.failed,r.data.skipped],[0,2,1]);
    for(const id of [10,11,12]) assert.equal((await service.readExplanation(f.sql.query,id)).status,'unwritten');
  }finally{await f.close();}
});

test('maximum batch and simultaneous duplicate submissions only update each row once',async()=>{
  const f=await importFixture();try{
    const input={explanations:Array.from({length:50},(_,i)=>item(i+10))};
    const p=(await f.call({action:'preview',input})).data;
    const request={action:'import',input,selected:selections(p)};
    const results=await Promise.all([f.call(request),f.call(request)]);
    assert(results.every(r=>r.status===200));
    assert.equal(results.reduce((sum,r)=>sum+r.data.success,0),50);
    assert.equal(results.reduce((sum,r)=>sum+r.data.skipped,0),50);
    const versions=await f.sql.query('SELECT explanation_version FROM questions WHERE id BETWEEN 10 AND 59',[]);
    assert(versions.every(r=>r.explanation_version===1));
  }finally{await f.close();}
});
