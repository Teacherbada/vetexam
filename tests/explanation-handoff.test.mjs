import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {load,adminService,http} from './helpers/official-explanation-fixture.mjs';
import {importFixture,handoff,batch,handoffContract} from './helpers/featured-explanation-import-fixture.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=';
const png2='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const md5=s=>createHash('md5').update(s).digest('hex');
async function fixture(){
 const f=await importFixture();await f.db.exec(readFileSync(new URL('../migrations/20261014_question_proofreading.sql',import.meta.url),'utf8'));
 await f.db.exec(`UPDATE questions SET option_e='第五選項',answer='["A","E"]' WHERE id=10;
 UPDATE questions SET answer='["A","B"]' WHERE id=11;
 UPDATE questions SET answer='["A","B","C","D"]' WHERE id=12;
 UPDATE questions SET answer='全給分' WHERE id=13;
 UPDATE questions SET answer='A+B' WHERE id=14;`);
 await f.sql.query('UPDATE questions SET image_data_url=$1 WHERE id IN (10,11)',[png]);
 await f.sql.query('INSERT INTO question_proofreading(question_id,version,images,image_fingerprint) VALUES(10,2,$1::jsonb,$2)',[JSON.stringify([png,png2]),md5(png)]);
 const admin=load('lib/admin.ts',{'@/lib/auth':{auth:{api:{getSession:async({headers})=>{const id=headers.get('x-fixture-user');return id?{user:{id}}:null;}}}},'@neondatabase/serverless':{neon:()=>f.sql}});
 const route=load('app/api/admin/questions/explanation/export/route.ts',{'@/lib/admin':admin,'@/lib/admin-question-http':http,'@/lib/explanation-handoff':handoff});
 const get=(params='questionSetId=1&afterId=9',user='fixture-admin')=>route.GET(new Request('http://localhost/api/admin/questions/explanation/export?'+params,{headers:user?{'x-fixture-user':user}:{}}));
 return {...f,get};
}
const example=JSON.parse(readFileSync(new URL('../public/examples/explanation-handoff.example.json',import.meta.url),'utf8'));
function item(q){const value=structuredClone(example.explanations[0]);return {...value,questionId:q.questionId,questionFingerprint:q.questionFingerprint,sourceFingerprint:q.sourceFingerprint,expectedAnswers:q.officialAnswers,optionExplanations:Object.fromEntries(Object.entries(q.options).filter(([,v])=>v?.trim()).map(([k])=>[k,`合成選項 ${k} 的獨立解析`])),references:[{...value.references[0],supports:['correctAnswerReason']}],doubts:[]};}
const file=items=>({formatVersion:handoffContract.HANDOFF_FORMAT,explanations:items});
const preview=(f,items)=>f.call({action:'preview',input:file(items)});
const snapshot=f=>f.sql.query("SELECT jsonb_agg(to_jsonb(q) ORDER BY id) AS all_questions FROM questions q",[]);

test('10-question export preserves identifiers, years, options/answers, deduplicated originals; no writes',async()=>{
 const f=await fixture();try{
  const before=await snapshot(f),response=await f.get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
  const data=await response.json();assert.equal(data.questions.length,10);assert.equal(data.formatVersion,'vetexam-question-handoff-v1');assert.equal(data.assets.length,2);assert.equal(data.nextAfterId,19);assert(!JSON.stringify(data).includes('base64'));
  const q=data.questions[0];assert.equal(q.questionId,10);assert.equal(q.questionSetId,1);assert.equal(q.exam_year,2026);assert.equal(q.rocYear,115);assert.equal(q.examSession,'unknown');assert.deepEqual(q.officialAnswers,['A','E']);assert.equal(q.options.E,'第五選項');assert.equal(q.sources.correctionVersion,'unknown');assert.equal(q.sources.officialAnswerSource,'unknown');assert.equal(q.images.length,2);assert.equal(data.questions[1].images[0].assetId,q.images[0].assetId);assert.equal(data.questions[5].images.length,0);
  for(const asset of data.assets){const r=await f.get(asset.downloadUrl.split('?')[1]);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^image\/png$/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');const expected=asset.id===q.images[0].assetId?png:png2;assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from(expected.split(',')[1],'base64'));}
  assert.deepEqual(await snapshot(f),before);
  assert.equal((await (await f.get('questionSetId=1&afterId=19&limit=20')).json()).questions[0].questionId,20);
  assert((await (await f.get('questionSetId=2')).json()).questions.length===0);
  await f.db.exec('UPDATE question_sets SET exam_year=105 WHERE id=1');assert.equal((await (await f.get()).json()).questions[0].rocYear,105);
 }finally{await f.close();}
});
test('real admin guard on JSON/images, strict filters, no hidden access or oversized media',async()=>{
 const f=await fixture();try{
  const data=await (await f.get()).json(),url=data.assets[0].downloadUrl.split('?')[1];
  for(const user of [null,'member'])for(const p of ['questionSetId=1',url])assert.equal((await f.get(p,user)).status,403);
  for(const user of [null,'member'])assert.equal((await f.call({action:'preview',input:file([item(data.questions[0])])},user)).status,403);
  for(const p of ['questionSetId=1&limit=21','questionSetId=1&limit=0','questionSetId=1&afterId=-1','questionSetId=1&ownerId=x','questionSetId=2&kind=exam'])assert.equal((await f.get(p)).status,400);
  assert.equal((await f.get(url.replace('questionId=10','questionId=3'))).status,404);
  await f.sql.query('UPDATE questions SET image_data_url=$1 WHERE id=11',['https://example.test/private.png']);assert.equal((await f.get()).status,400);
  await f.sql.query('UPDATE questions SET image_data_url=$1 WHERE id=11',['data:image/png;base64,'+'A'.repeat(3_800_001)]);assert.equal((await f.get()).status,400);
  await f.sql.query('UPDATE questions SET image_data_url=$1 WHERE id=11',['x'.repeat(33*1024*1024)]);assert.equal((await f.get()).status,413);
 }finally{await f.close();}
});
test('single, multiple and E answers preview via existing converter; all formats stay read-only',async()=>{
 const f=await fixture();try{
  const before=await snapshot(f),data=await (await f.get()).json(),items=data.questions.filter(q=>![12,13,14].includes(q.questionId)).map(item);
  const r=await preview(f,items);assert.equal(r.status,200);assert(r.data.handoffPreview);assert(r.data.rows.every(q=>q.category==='ready'&&!q.token));assert.match(r.data.rows[0].explanation,/#### E/);assert.match(r.data.rows[0].explanation,/內容尚未查核/);
  const retry=await Promise.all([preview(f,items),preview(f,items)]);assert(retry.every(r=>r.status===200));
  assert.equal((await f.call({action:'import',input:file(items),selected:[{index:0,token:'forged'}]})).status,409);
  assert.deepEqual(await snapshot(f),before);
  const legacy={explanations:[{questionId:10,expectedAnswer:['A','E'],explanation:'既有格式 E 複數答案測試'}]};assert.equal((await f.call({action:'preview',input:legacy})).data.rows[0].category,'ready');
 }finally{await f.close();}
});
test('changes after export reject text, answer corrections, options, images and source snapshots',async()=>{
 const f=await fixture();try{
  for(const [column,value] of [['question','更正題幹'],['answer','B'],['option_a','更正選項'],['image_data_url',png2]]){
   const data=await (await f.get()).json(),q=data.questions.find(q=>q.questionId===11),original=(await f.sql.query(`SELECT ${column} FROM questions WHERE id=11`,[]))[0][column];
   const imageParams=`questionId=11&image=0&sourceFingerprint=${q.sourceFingerprint}`;assert.equal((await f.get(imageParams)).status,200);
   await f.sql.query(`UPDATE questions SET ${column}=$1 WHERE id=11`,[value]);const r=await preview(f,[item(q)]);assert.notEqual(r.data.rows[0].category,'ready',column);
   assert.equal((await f.get(imageParams)).status,409);
   await f.sql.query(`UPDATE questions SET ${column}=$1 WHERE id=11`,[original]);
  }
  const old=await (await f.get()).json();await f.sql.query('UPDATE question_proofreading SET images=$1::jsonb WHERE question_id=10',[JSON.stringify([png2,png])]);assert.equal((await preview(f,[item(old.questions[0])])).data.rows[0].category,'invalid');
  const data=await (await f.get()).json(),q=data.questions[0];await f.db.exec("UPDATE question_sets SET file_hash='new-source-version' WHERE id=1");assert.equal((await preview(f,[item(q)])).data.rows[0].category,'invalid');assert.equal((await f.get(data.assets[0].downloadUrl.split('?')[1])).status,409);
 }finally{await f.close();}
});
test('special keys, all-credit, disputes, missing references/options, fingerprints and forged review fail closed',async()=>{
 const f=await fixture();try{
  const data=await (await f.get()).json(),normal=item(data.questions[0]);
  for(const id of [12,13,14]){const q=data.questions.find(q=>q.questionId===id);assert(q.manualReviewReasons.length);assert.equal((await preview(f,[item(q)])).data.rows[0].category,'invalid');}
  const patches=[{references:[]},{questionFingerprint:'0'.repeat(64)},{sourceFingerprint:'0'.repeat(64)},{expectedAnswers:['A']},{optionExplanations:{A:'only A'}},{reviewStatus:'published'},{question:'must not change'},{doubts:[{code:'answer_dispute',detail:'待官方核對'}]},{references:[{...normal.references[0],verificationStatus:'verified'}]},{references:[{...normal.references[0],url:'javascript:alert(1)'}]},{references:[{...normal.references[0],url:'https://user:pass@example.test'}]},{references:[{...normal.references[0],supports:['optionExplanations.Z']}]},{references:[{...normal.references[0],supports:['coreConcept']}]},{coreConcept:'x'.repeat(6001)},{expectedAnswers:['E','E']}];
  for(const patch of patches){const r=await preview(f,[{...normal,...patch}]);assert.notEqual(r.data.rows[0].category,'ready',JSON.stringify(patch));}
  const duplicate=await preview(f,[normal,normal]);assert(duplicate.data.rows.every(r=>r.category==='invalid'));
  assert.equal((await preview(f,[{...normal,questionId:999}])).data.rows[0].category,'not_found');
  for(const id of [3,4])assert.equal((await preview(f,[{...normal,questionId:id}])).data.rows[0].category,'not_found');
  await f.db.exec("UPDATE questions SET explanation='existing draft' WHERE id=10");assert.equal((await preview(f,[normal])).data.rows[0].category,'existing');await f.db.exec("UPDATE questions SET explanation_status='published' WHERE id=10");assert.equal((await preview(f,[normal])).data.rows[0].category,'existing');
  for(const value of [{formatVersion:'unknown',explanations:[normal]},file([]),file(Array(21).fill(normal)),{...file([normal]),owner:'x'}])assert.equal((await f.call({action:'preview',input:value})).status,400);
  assert.equal((await f.call('{bad JSON')).status,400);
 }finally{await f.close();}
});
test('formal schema/example and converter lengths match the API contract',()=>{
 const require=createRequire(import.meta.url),Ajv=require('ajv'),ajv=new Ajv({allErrors:true});
 const schema=JSON.parse(readFileSync(new URL('../public/examples/explanation-handoff.schema.json',import.meta.url),'utf8'));
 const validate=ajv.compile(schema);assert(validate(example),JSON.stringify(validate.errors));assert.doesNotThrow(()=>handoff.parseStructured(example.explanations[0]));
 const changed=structuredClone(example);changed.explanations[0].reviewStatus='verified';assert(!validate(changed));
 const value=structuredClone(example.explanations[0]);value.coreConcept='x'.repeat(6000);value.correctAnswerReason='x'.repeat(6000);value.examMemory='x'.repeat(6000);value.extendedKnowledge='x'.repeat(6000);
 const legacy=batch.parseImport({explanations:[{questionId:10,expectedAnswer:['A','E'],explanation:handoff.structuredMarkdown(value)}]});assert.equal(legacy[0].row.category,'invalid');
 assert.throws(()=>handoff.parseStructured({...value,coreConcept:'\0'}));
});
