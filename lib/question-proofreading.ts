import 'server-only';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {QuestionAdminError} from './admin-questions';
import {questionIssues,numberingIssues,proofInput,type ImageInput,type ProofContent} from './question-proofreading-input';
import {composeProofImages,rasterData} from './question-proofreading-images';
import {answerKeys,serializeAnswer} from './question-answer';

type Query=(text:string,values:unknown[])=>Promise<Record<string,unknown>[]>;
type QuestionRow=Record<string,unknown>&{id:number;question_set_id:number;question_number:number;subject:string;chapter:string|null;question:string|null;answer:string|null;explanation:string|null;explanation_status:string;explanation_version:string;image_hash:string;has_image:boolean;image_valid:boolean;edit_version:string;reviewed_fingerprint:string|null;reviewed_at:string|null;history_notice:boolean;image_count:number};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const md5=(v:string)=>createHash('md5').update(v).digest('hex');
const selection=`SELECT q.id,q.question_set_id,q.question_number,q.subject,q.chapter,q.question,
 q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,q.answer,q.explanation,q.explanation_status,q.explanation_version::text,
 md5(COALESCE(q.image_data_url,'')) AS image_hash,(NULLIF(q.image_data_url,'') IS NOT NULL) AS has_image,
 (q.image_data_url IS NULL OR q.image_data_url='' OR q.image_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$') AS image_valid,
 COALESCE(m.version,0)::text AS edit_version,m.reviewed_fingerprint,m.reviewed_at,m.history_notice,
 CASE WHEN m.image_fingerprint=md5(COALESCE(q.image_data_url,'')) AND m.images IS NOT NULL THEN jsonb_array_length(m.images)
 WHEN NULLIF(q.image_data_url,'') IS NOT NULL THEN 1 ELSE 0 END AS image_count
 FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
 LEFT JOIN question_proofreading m ON m.question_id=q.id
 WHERE q.kind='exam' AND qs.visibility='public'`;
function options(row:QuestionRow){const a=['a','b','c','d','e'].map(k=>String(row['option_'+k]??''));while(a.length>2&&!a.at(-1))a.pop();return a;}
function rowView(q:QuestionRow){
  const content:ProofContent={question:q.question??'',options:options(q),answer:q.answer??'',explanation:q.explanation??''};
  const fingerprint=hash([q.id,q.question_set_id,q.question_number,q.subject,q.chapter,content,q.explanation_status,q.explanation_version,q.image_hash]);
  return {...content,id:Number(q.id),bankId:Number(q.question_set_id),number:Number(q.question_number),subject:q.subject,
    revision:hash([fingerprint,q.edit_version]),fingerprint,reviewed:q.reviewed_fingerprint===fingerprint,reviewedAt:q.reviewed_at,
    hasImage:q.has_image,imageCount:Number(q.image_count),explanationStatus:content.explanation.trim()?q.explanation_status:'unwritten',
    issues:questionIssues({...content,imageValid:q.image_valid}),historyNotice:q.history_notice===true};
}
async function raw(query:Query,id:number,lock=false){
  const rows=await query(selection+' AND q.id=$1'+(lock?' FOR UPDATE OF q,qs':''),[id]);
  if(!rows.length)throw new QuestionAdminError('找不到可校對的公開國考題目',404);return rows[0] as QuestionRow;
}
async function originalImages(query:Query,id:number){
  const [r]=await query(`SELECT q.image_data_url,m.images,m.image_fingerprint FROM questions q LEFT JOIN question_proofreading m ON m.question_id=q.id WHERE q.id=$1`,[id]);
  if(r.images!==null&&r.image_fingerprint===md5(String(r.image_data_url??'')))return r.images as string[];
  return r.image_data_url?[r.image_data_url as string]:[];
}
export async function proofBanks(query:Query){return query(`SELECT qs.id,qs.name,qs.exam_year,qs.exam_subject,COUNT(q.id)::int AS count
 FROM question_sets qs JOIN questions q ON q.question_set_id=qs.id AND q.kind='exam' WHERE qs.visibility='public'
 GROUP BY qs.id ORDER BY qs.exam_year DESC NULLS LAST,qs.id DESC`,[]);}
export async function proofBank(query:Query,id:number){
  const [bank]=await query("SELECT id,name,exam_year,exam_subject,total_questions FROM question_sets WHERE id=$1 AND visibility='public'",[id]) as {id:number;name:string;exam_year:number;exam_subject:string;total_questions:number}[];
  if(!bank)throw new QuestionAdminError('找不到公開國考考卷',404);
  const questions=(await query(selection+' AND q.question_set_id=$1 ORDER BY q.question_number,q.id',[id]) as QuestionRow[]).map(rowView);
  const numbering=numberingIssues(questions,Number(bank.total_questions));
  for(const q of questions)if(numbering.duplicate.includes(q.number))q.issues.push('題號重複');
  const revision=hash([bank,questions.map(q=>[q.id,q.revision,q.reviewed])]);
  const [complete]=await query('SELECT fingerprint,completed_at FROM question_bank_proofreading WHERE question_set_id=$1',[id]);
  const reviewed=questions.filter(q=>q.reviewed).length;
  return {bank,questions,numbering,revision,summary:{total:questions.length,reviewed,pending:questions.length-reviewed,abnormal:questions.filter(q=>q.issues.length).length},completed:complete?.fingerprint===revision,completedAt:complete?.completed_at??null};
}
export async function proofDetail(query:Query,id:number){
  const q=rowView(await raw(query,id));
  const [stats]=await query(`SELECT (SELECT count(*)::int FROM question_answer_stats WHERE question_id=$1) AS first_answers,
   (SELECT count(*)::int FROM practice_attempts WHERE question_id=$1) AS attempts,
   (SELECT count(*)::int FROM diagnostic_items WHERE source_question_id=$1) AS coach`,[id]);
  return {...q,stats:{first_answers:Number(stats.first_answers),attempts:Number(stats.attempts),coach:Number(stats.coach)},images:Array.from({length:q.imageCount},(_,index)=>({questionId:id,index,revision:q.revision,url:`/api/admin/questions/proofread?image=${index}&id=${id}&revision=${q.revision}`}))};
}
export async function proofImage(query:Query,id:number,index:number,revision:string){
  const q=rowView(await raw(query,id));if(q.revision!==revision)throw new QuestionAdminError('圖片版本已更新，請重新載入題目',409);
  const src=(await originalImages(query,id))[index];if(!src||!rasterData(src))throw new QuestionAdminError('圖片失效或非受支援的原圖，請重新上傳',404);
  return src;
}
export async function proofHistory(query:Query,id:number,historyId?:number){
  await raw(query,id);
  if(historyId)return query(`SELECT id,actor_id,created_at,action,changed_fields,
   before_data - 'images' - 'image_data_url' AS before,after_data - 'images' - 'image_data_url' AS after
   FROM question_edit_history WHERE question_id=$1 AND id=$2`,[id,historyId]);
  return query(`SELECT id,actor_id,created_at,action,changed_fields,
   jsonb_build_object('question',left(before_data->>'question',300),'answer',before_data->>'answer','imageCount',before_data->'imageCount') AS before,
   jsonb_build_object('question',left(after_data->>'question',300),'answer',after_data->>'answer','imageCount',after_data->'imageCount') AS after
   FROM question_edit_history WHERE question_id=$1 ORDER BY id DESC LIMIT 50`,[id]);
}
async function stored(query:Query,id:number){const q=await raw(query,id);return {...rowView(q),images:await originalImages(query,id),image_data_url:(await query('SELECT image_data_url FROM questions WHERE id=$1',[id]))[0].image_data_url as string|null};}
export async function changeProof(client:Pick<PoolClient,'query'>,body:Record<string,unknown>,actor:string){
  let input:Record<string,unknown>;try{input=proofInput(body);}catch(e){throw new QuestionAdminError((e as Error).message);}
  const query:Query=async(t,v)=>(await client.query(t,v)).rows;
  if(input.action==='complete'){
    await client.query('SELECT id FROM question_sets WHERE id=$1 FOR UPDATE',[input.bankId]);
    await client.query('SELECT id FROM questions WHERE question_set_id=$1 FOR UPDATE',[input.bankId]);
    const bank=await proofBank(query,Number(input.bankId));
    if(bank.revision!==input.revision)throw new QuestionAdminError('考卷已變更，請重新載入',409);
    if(!bank.numbering.valid||bank.summary.pending||!bank.summary.total)throw new QuestionAdminError('必須逐題人工核對，且題數與連續題號符合原考卷，才能確認完成');
    await client.query(`INSERT INTO question_bank_proofreading(question_set_id,fingerprint,completed_by) VALUES($1,$2,$3)
     ON CONFLICT(question_set_id) DO UPDATE SET fingerprint=$2,completed_by=$3,completed_at=now()`,[input.bankId,bank.revision,actor]);
    return {bank:await proofBank(query,Number(input.bankId))};
  }
  // Match existing answer writers' lock order. No attempts or history are deleted.
  await client.query('LOCK TABLE question_answer_stats IN SHARE ROW EXCLUSIVE MODE');
  const id=Number(input.id);await raw(query,id,true);
  const retry=await query('SELECT question_id FROM question_edit_history WHERE actor_id=$1 AND request_id=$2',[actor,input.requestId]);
  if(retry.length){if(Number(retry[0].question_id)!==id)throw new QuestionAdminError('操作識別碼已用於其他題目',409);return {question:await proofDetail(query,id),replayed:true};}
  const before=await stored(query,id);
  if(before.revision!==input.revision)throw new QuestionAdminError('題目已被其他操作更新，請保留草稿並重新載入後核對',409);
  let fields:string[]=[];
  if(input.action==='review'||input.action==='unreview'){
    if(input.action==='review'){
      if(!before.question.trim()||!answerKeys(before.answer).length||before.options.some(o=>!o.trim())||answerKeys(before.answer).some(a=>!before.options[a.charCodeAt(0)-65]))throw new QuestionAdminError('題幹、選項及答案需完整才能標記已核對');
      if(before.issues.length&&input.confirmWarnings!==true)throw new QuestionAdminError('請先確認已人工核對異常提示');
      for(const image of before.images){try{await composeProofImages([image]);}catch{throw new QuestionAdminError('圖片無法讀取，不能標記已核對');}}
    }
    await client.query(`INSERT INTO question_proofreading(question_id,version,reviewed_fingerprint,reviewed_by,reviewed_at) VALUES($1,1,$2,$3,now())
     ON CONFLICT(question_id) DO UPDATE SET version=question_proofreading.version+1,reviewed_fingerprint=$2,reviewed_by=$3,reviewed_at=now()`,[id,input.action==='review'?before.fingerprint:null,actor]);fields=['review'];
  }else{
    let next:ProofContent,images:string[];
    if(input.action==='restore'){
      const [history]=await query('SELECT before_data FROM question_edit_history WHERE id=$1 AND question_id=$2',[input.historyId,id]);
      if(!history)throw new QuestionAdminError('找不到本題的歷史版本',404);
      const original=history.before_data as Awaited<ReturnType<typeof stored>>;
      next=original;images=original.images;
      try{proofInput({...input,action:'save',question:next.question,options:next.options,answer:next.answer,explanation:next.explanation,images:[]});}catch{throw new QuestionAdminError('此舊版本含不完整內容，請參考歷史手動修正，不可直接回復');}
    }else{
      next={question:input.question as string,options:input.options as string[],answer:input.answer as string,explanation:input.explanation as string};images=[];
      for(const img of input.images as ImageInput[]){
        if('dataUrl' in img){images.push(img.dataUrl);continue;}
        const source=rowView(await raw(query,img.questionId));
        if(source.bankId!==before.bankId||source.revision!==img.revision)throw new QuestionAdminError('圖片來源題目已變更或不屬於本卷，請重新選擇',409);
        const src=(await originalImages(query,img.questionId))[img.index];if(!src)throw new QuestionAdminError('圖片參照不存在');images.push(src);
      }
    }
    const optionsChanged=JSON.stringify(next.options)!==JSON.stringify(before.options),answerChanged=serializeAnswer(next.answer,true)!==serializeAnswer(before.answer,true);
    for(const k of ['question','options','answer','explanation'] as const)if(JSON.stringify(next[k])!==JSON.stringify(before[k]))fields.push(k);
    if(JSON.stringify(images)!==JSON.stringify(before.images))fields.push('images');
    if(!fields.length)return {question:await proofDetail(query,id),unchanged:true};
    if((optionsChanged||answerChanged)&&input.confirmAnswer!==true)throw new QuestionAdminError('選項或答案已修改，請重新確認每個官方接受答案');
    if(before.explanation.trim()&&!next.explanation.trim())throw new QuestionAdminError('不可清空既有解析；可編輯內容或維持草稿');
    if((next.explanation.trim()||before.explanation.trim())&&input.confirmExplanation!==true)throw new QuestionAdminError('請確認解析是否仍適用修改後題目；儲存後將回到草稿');
    if(input.recalculateStats===true&&(optionsChanged||next.question!==before.question))throw new QuestionAdminError('題幹或選項變更時不可用新內容重算舊選項紀錄');
    let composite=before.image_data_url;
    if(fields.includes('images')){try{composite=await composeProofImages(images);}catch(e){throw new QuestionAdminError((e as Error).message);}}
    await client.query(`UPDATE questions SET question=$2,option_a=$3,option_b=$4,option_c=$5,option_d=$6,option_e=$7,answer=$8,
     explanation=$9,explanation_status='draft',explanation_version=explanation_version+1,image_data_url=$10 WHERE id=$1`,[id,next.question,...Array.from({length:5},(_,i)=>next.options[i]??''),next.answer,next.explanation,composite]);
    await client.query(`INSERT INTO question_proofreading(question_id,version,images,image_fingerprint,history_notice) VALUES($1,1,$2::jsonb,$3,$4)
     ON CONFLICT(question_id) DO UPDATE SET version=question_proofreading.version+1,images=$2::jsonb,image_fingerprint=$3,
     reviewed_fingerprint=NULL,reviewed_by=NULL,reviewed_at=NULL,history_notice=question_proofreading.history_notice OR $4`,[id,JSON.stringify(images),md5(composite??''),optionsChanged||answerChanged||next.question!==before.question]);
    if(answerChanged&&input.recalculateStats===true){
      await client.query(`UPDATE question_answer_stats SET is_correct=selected_answer=ANY(vetexam_answer_keys($2)),updated_at=now()
       WHERE question_id=$1 AND selected_answer ~ '^[A-E]$'`,[id,next.answer]);fields.push('first_answer_statistics');
    }
  }
  await client.query(`INSERT INTO question_edit_history(question_id,actor_id,action,changed_fields,before_data,after_data,request_id)
   VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,[id,actor,input.action,fields,JSON.stringify(before),JSON.stringify(await stored(query,id)),input.requestId]);
  return {question:await proofDetail(query,id)};
}
