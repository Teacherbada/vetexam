import 'server-only';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {QuestionAdminError,checkPreviewToken} from './admin-questions';
import {parseImport,parseSelections,previewImport,applyImport} from './featured-explanation-import';
import {previewHandoff,parseStructured,structuredMarkdown,handoffTokenFingerprint} from './explanation-handoff';
import type {ImportResult,ImportOutcome} from './featured-explanation-import-input';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Client=Pick<PoolClient,'query'>;
export type ReceiptResult=ImportResult&{receiptId:string;replayed?:boolean};

/** Transaction includes receipt, validation, drafts and source bindings. No AI/network calls. */
export async function safeExplanationImport(client:Client,input:unknown,selected:unknown,actor:string,requestId:unknown):Promise<ReceiptResult>{
  const structured=!!input&&typeof input==='object'&&'formatVersion' in input;
  // Malformed envelopes are rejected before acquiring any receipt/row locks.
  const query=async(text:string,values:unknown[])=>(await client.query(text,values)).rows;
  // Validate shape without reading mutable questions. A committed receipt must
  // remain replayable even after its original questions/images change or vanish.
  const initial=structured?await previewHandoff(async()=>[],input,actor):null;
  const raw=structured?(input as unknown as {explanations:unknown[]}).explanations:[];
  const entries=structured?parseImport({explanations:raw.map((value,index)=>{
    if(initial!.rows[index].category==='invalid')return {};
    const item=parseStructured(value);return {questionId:item.questionId,expectedAnswer:item.expectedAnswers,questionFingerprint:item.questionFingerprint,explanation:structuredMarkdown(item)};
  })}):parseImport(input);
  const chosen=parseSelections(selected,entries);
  if(requestId!==undefined&&(typeof requestId!=='string'||!uuid.test(requestId)))throw new QuestionAdminError('requestId 必須為 UUID');
  if(structured&&requestId===undefined)throw new QuestionAdminError('新版匯入必須提供 requestId，以便安全重試');
  const payload=hash([input,chosen.map(s=>s.index).sort((a,b)=>a-b)]);
  // Old clients receive a stable receipt without changing their request contract.
  const id=typeof requestId==='string'?requestId:payload;
  await client.query(`INSERT INTO explanation_import_receipts(actor_id,request_id,payload_hash,input)
    VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,[actor,id,payload,JSON.stringify(input)]);
  const [receipt]=await query('SELECT payload_hash,result FROM explanation_import_receipts WHERE actor_id=$1 AND request_id=$2 FOR UPDATE',[actor,id]);
  if(receipt.payload_hash!==payload)throw new QuestionAdminError('此收據識別碼已用於不同內容，請重新預覽',409);
  if(receipt.result)return {...receipt.result as ReceiptResult,replayed:true};
  const ids=structured?initial!.rows.flatMap(r=>r.questionId?[r.questionId]:[]):entries.flatMap(e=>e.row.questionId?[e.row.questionId]:[]);
  await client.query(`SELECT q.id FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
    WHERE q.id=ANY($1::int[]) AND q.kind='exam' AND qs.visibility='public' ORDER BY q.id FOR UPDATE OF q FOR SHARE OF qs`,[ids]);
  // Metadata writers also lock q or invalidate publication through database triggers.
  await client.query('SELECT question_id FROM question_proofreading WHERE question_id=ANY($1::int[]) ORDER BY question_id FOR UPDATE',[ids]);
  let result:ImportResult;
  if(structured){
    const checked=await previewHandoff(query,input,actor);
    const versions=await query('SELECT id,explanation_version::text FROM questions WHERE id=ANY($1::int[])',[ids]);
    const byId=new Map(versions.map(q=>[Number(q.id),q.explanation_version]));
    const legacy=await previewImport(query,entries,actor);
    const accepted:typeof chosen=[];
    const failures=new Map<number,ImportOutcome>();
    for(const choice of chosen){
      const row=checked.rows[choice.index];
      if(row.category!=='ready')failures.set(choice.index,{index:choice.index,questionId:row.questionId,status:row.category==='existing'?'skipped':'failed',reason:row.reason});
      else if(!checkPreviewToken(choice.token,handoffTokenFingerprint(raw[choice.index],byId.get(row.questionId!)),actor))failures.set(choice.index,{index:choice.index,questionId:row.questionId,status:'failed',reason:'預覽已過期或內容已變更，請重新預覽'});
      else accepted.push({index:choice.index,token:legacy.rows[choice.index].token!});
    }
    result=await applyImport(client,entries,accepted,actor);
    result.rows=result.rows.map(r=>failures.get(r.index)??r);
    result.success=result.rows.filter(r=>r.status==='success').length;
    result.failed=result.rows.filter(r=>r.status==='failed').length;
    result.skipped=result.rows.filter(r=>r.status==='skipped').length;
  }else result=await applyImport(client,entries,chosen,actor);
  const written=result.rows.filter(r=>r.status==='success');
  const bindings=written.map(row=>{
    const item=structured?parseStructured(raw[row.index]):null;
    return {id:row.questionId,question_fingerprint:item?.questionFingerprint??null,source_fingerprint:item?.sourceFingerprint??null};
  });
  if(bindings.length){
    const versions=await query(`UPDATE questions q SET explanation_binding=jsonb_build_object('sourceSignature',vetexam_explanation_source(q.id),
      'receiptId',$2::text,'questionFingerprint',v.question_fingerprint,'sourceFingerprint',v.source_fingerprint,'reviewStatus','pending_review')
      FROM jsonb_to_recordset($1::jsonb) AS v(id integer,question_fingerprint text,source_fingerprint text)
      WHERE q.id=v.id RETURNING q.id,q.explanation_version::text,(q.explanation_version-1)::text AS previous_version`,[JSON.stringify(bindings),id]);
    if(versions.length!==bindings.length)throw new QuestionAdminError('解析版本綁定失敗，本批交易已回復',409);
    for(const row of written){const version=versions.find(v=>Number(v.id)===row.questionId)!;Object.assign(row,{explanationVersion:version.explanation_version,previousVersion:version.previous_version});}
  }
  const response={...result,receiptId:id};
  await client.query('UPDATE explanation_import_receipts SET result=$3::jsonb WHERE actor_id=$1 AND request_id=$2',[actor,id,JSON.stringify(response)]);
  return response;
}

export async function readImportReceipt(query:(text:string,values:unknown[])=>Promise<Record<string,unknown>[]>,actor:string,id:string){
  if(!id)return {receipts:await query('SELECT request_id AS "receiptId",created_at AS "createdAt",result FROM explanation_import_receipts WHERE actor_id=$1 ORDER BY created_at DESC,request_id LIMIT 20',[actor])};
  if(!uuid.test(id)&&!/^[a-f0-9]{64}$/.test(id))throw new QuestionAdminError('收據識別碼無效');
  const [row]=await query('SELECT request_id AS "receiptId",created_at AS "createdAt",result FROM explanation_import_receipts WHERE actor_id=$1 AND request_id=$2',[actor,id]);
  if(!row)throw new QuestionAdminError('找不到匯入收據',404);
  return row;
}
