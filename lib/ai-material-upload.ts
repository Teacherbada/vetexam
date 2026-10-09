import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {QuestionAdminError} from './admin-questions';
import {uuid} from './ai-question-input';
import {MATERIAL_LIMITS} from './ai-material-input';
import {questionTransaction} from './question-transaction';
import {extractMaterialPDF} from './ai-material-pdf';
export async function beginMaterialUpload(client:PoolClient,body:Record<string,unknown>,userId:string) {
  if(!uuid(body.id)||typeof body.filename!=='string'||!body.filename.trim()||body.filename.length>200||!Number.isSafeInteger(body.size)||Number(body.size)<5||Number(body.size)>MATERIAL_LIMITS.maxFileBytes)throw new QuestionAdminError('PDF 最多 100 MB，請提供有效檔案');
  await client.query('LOCK TABLE ai_material_uploads IN SHARE ROW EXCLUSIVE MODE');
  // Temporary chunks only; never delete a saved material/question/attempt.
  await client.query("DELETE FROM ai_material_uploads WHERE expires_at<now() AND status<>'done' AND (claimed_at IS NULL OR claimed_at<now()-interval '6 minutes')");
  let row=(await client.query('SELECT * FROM ai_material_uploads WHERE id=$1',[body.id])).rows[0];
  if(row && (row.created_by!==userId||row.filename!==body.filename||row.byte_length!==body.size))throw new QuestionAdminError('上傳識別碼與檔案不符',409);
  if(!row){
    if(Number((await client.query("SELECT count(*) AS n FROM ai_material_uploads WHERE status<>'done'")).rows[0].n)>=5)throw new QuestionAdminError('最多同時保留 5 份未完成教材上傳，請先完成或於 24 小時後重試',429);
    row=(await client.query('INSERT INTO ai_material_uploads(id,created_by,filename,byte_length) VALUES($1,$2,$3,$4) RETURNING *',[body.id,userId,body.filename,body.size])).rows[0];
  }
  const received=(await client.query('SELECT position FROM ai_material_upload_chunks WHERE upload_id=$1 ORDER BY position',[row.id])).rows.map(r=>r.position);
  return {id:row.id,status:row.status,materialId:row.material_id,received,chunkBytes:MATERIAL_LIMITS.chunkBytes};
}
export async function putMaterialChunk(client:PoolClient,body:Record<string,unknown>,userId:string) {
  if(!uuid(body.id)||!Number.isSafeInteger(body.position)||typeof body.data!=='string'||body.data.length>Math.ceil(MATERIAL_LIMITS.chunkBytes/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.data))throw new QuestionAdminError('上傳分段無效');
  const row=(await client.query('SELECT * FROM ai_material_uploads WHERE id=$1 AND created_by=$2 AND expires_at>now() FOR UPDATE',[body.id,userId])).rows[0];
  if(!row||row.status!=='uploading')throw new QuestionAdminError('上傳不存在、過期或正在處理',409);
  const position=Number(body.position),count=Math.ceil(row.byte_length/MATERIAL_LIMITS.chunkBytes);
  const bytes=Buffer.from(body.data,'base64');
  const expected=position===count-1?row.byte_length-position*MATERIAL_LIMITS.chunkBytes:MATERIAL_LIMITS.chunkBytes;
  if(position<0||position>=count||bytes.length!==expected||bytes.toString('base64')!==body.data)throw new QuestionAdminError('上傳分段長度或順序範圍無效');
  if(position===0&&bytes.subarray(0,5).toString()!=='%PDF-')throw new QuestionAdminError('不是 PDF 檔案');
  const hash=createHash('sha256').update(bytes).digest('hex');
  const previous=(await client.query('SELECT fingerprint FROM ai_material_upload_chunks WHERE upload_id=$1 AND position=$2',[body.id,position])).rows[0];
  if(previous&&previous.fingerprint!==hash)throw new QuestionAdminError('同一分段內容已改變，請重新選取正確檔案',409);
  if(!previous)await client.query('INSERT INTO ai_material_upload_chunks(upload_id,position,bytes,fingerprint) VALUES($1,$2,$3,$4)',[body.id,position,bytes,hash]);
  return {received:position,replayed:!!previous};
}
export async function claimMaterialUpload(client:PoolClient,id:string,userId:string){
  if(!uuid(id))throw new QuestionAdminError('上傳識別碼無效');
  const row=(await client.query("SELECT *,claimed_at>now()-interval '6 minutes' AS active FROM ai_material_uploads WHERE id=$1 AND created_by=$2 AND (expires_at>now() OR status='done') FOR UPDATE",[id,userId])).rows[0];
  if(!row)throw new QuestionAdminError('找不到上傳或已過期',404);
  if(row.status==='done')return {material:(await client.query('SELECT id,filename,pages FROM ai_materials WHERE id=$1',[row.material_id])).rows[0]};
  if(row.status==='processing'&&row.active)throw new QuestionAdminError('教材正在擷取文字，請稍候再試',409);
  const summary=(await client.query('SELECT count(*)::int AS count,coalesce(sum(octet_length(bytes)),0)::int AS size,min(position) AS first,max(position) AS last FROM ai_material_upload_chunks WHERE upload_id=$1',[id])).rows[0];
  if(summary.count!==Math.ceil(row.byte_length/MATERIAL_LIMITS.chunkBytes)||summary.first!==0||summary.last!==summary.count-1||summary.size!==row.byte_length)throw new QuestionAdminError('檔案尚未上傳完整，請重新選取同一檔案續傳');
  const claim=randomUUID();await client.query("UPDATE ai_material_uploads SET status='processing',claim=$2,claimed_at=now() WHERE id=$1",[id,claim]);
  return {id,claim,filename:row.filename,byteLength:row.byte_length as number};
}
export async function finishMaterialUpload(id:string,userId:string){
  const work=await questionTransaction(client=>claimMaterialUpload(client,id,userId));
  if('material' in work)return {material:work.material};
  try{
    // Keep each database read bounded too: the shared transaction helper has a
    // 15-second statement limit, so don't read a 100 MB bytea in one query.
    const parts:Buffer[]=[];
    for(let start=0;start<Math.ceil(work.byteLength/MATERIAL_LIMITS.chunkBytes);start+=4){
      const rows=await questionTransaction(async client=>(await client.query("SELECT c.bytes FROM ai_material_upload_chunks c JOIN ai_material_uploads u ON u.id=c.upload_id WHERE u.id=$1 AND u.claim=$2 AND u.status='processing' AND c.position>=$3 AND c.position<$4 ORDER BY c.position",[id,work.claim,start,start+4])).rows);
      parts.push(...rows.map(r=>r.bytes));
    }
    if(parts.reduce((size,part)=>size+part.length,0)!==work.byteLength)throw new QuestionAdminError('上傳處理版本已變更，請重試',409);
    const bytes=Buffer.concat(parts,work.byteLength);parts.length=0;
    const pages=await extractMaterialPDF(new Uint8Array(bytes));
    const fingerprint=createHash('sha256').update(bytes).digest('hex');
    return await questionTransaction(async client=>{
      const row=(await client.query('SELECT claim,status FROM ai_material_uploads WHERE id=$1 FOR UPDATE',[id])).rows[0];
      if(row?.claim!==work.claim||row.status!=='processing')throw new QuestionAdminError('上傳處理版本已變更',409);
      // Assemble the already-uploaded chunks in PostgreSQL; do not send 100 MB back
      // across the database connection a second time after extracting text.
      const material=(await client.query("INSERT INTO ai_materials(id,fingerprint,filename,pdf,pages,created_by) SELECT $1,$2,$3,string_agg(bytes,''::bytea ORDER BY position),$4::jsonb,$5 FROM ai_material_upload_chunks WHERE upload_id=$6 ON CONFLICT(fingerprint) DO UPDATE SET fingerprint=EXCLUDED.fingerprint RETURNING id,filename,pages",[randomUUID(),fingerprint,work.filename,JSON.stringify(pages),userId,id])).rows[0];
      await client.query("UPDATE ai_material_uploads SET status='done',material_id=$2 WHERE id=$1",[id,material.id]);
      await client.query('DELETE FROM ai_material_upload_chunks WHERE upload_id=$1',[id]);
      return {material};
    });
  }catch(error){
    await questionTransaction(client=>client.query("UPDATE ai_material_uploads SET status='uploading',claim=NULL,claimed_at=NULL WHERE id=$1 AND claim=$2 AND status='processing'",[id,work.claim]));
    if(error instanceof QuestionAdminError)throw error;
    throw new QuestionAdminError('教材擷取失敗，已保留分段可續傳；請確認 PDF 未加密且在頁數限制內');
  }
}
