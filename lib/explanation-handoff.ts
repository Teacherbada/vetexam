import 'server-only';
import {createHash} from 'node:crypto';
import {QuestionAdminError} from './admin-questions';
import {validId} from './admin-question-input';
import {answerKeys} from './question-answer';
import {parseImport,previewImport,questionFingerprint} from './featured-explanation-import';
import {IMPORT_FILE_BYTES,type ExplanationImportRow} from './featured-explanation-import-input';
import {EXPORT_FORMAT,HANDOFF_FORMAT,type StructuredExplanation,type HandoffQuestion,type HandoffAsset,type QuestionHandoff} from './explanation-handoff-input';

type Row=Record<string,unknown>;
type Query=(text:string,values:unknown[])=>Promise<Row[]>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const md5=(value:string)=>createHash('md5').update(value).digest('hex');
const letters=['A','B','C','D','E'] as const;
const unknownSource={officialQuestionSource:'unknown',officialAnswerSource:'unknown',correctionVersion:'unknown'} as const;
const imagePattern=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const maxImageChars=3_800_000, maxBatchBytes=32*1024*1024;
// One statement = one DB snapshot. Oversized images never travel across the DB connection.
async function readRows(query:Query,where:string,values:unknown[],limit=20){
  return query(`WITH selected AS (
    SELECT q.id,q.question_set_id,q.question_number,q.subject,q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,
      q.answer,q.image_data_url,q.explanation,q.explanation_status,q.explanation_version::text,
      qs.exam_year,qs.exam_subject,qs.name,qs.filename,qs.file_hash,
      COALESCE(m.version,0)::text AS proofreading_version,m.images,m.image_fingerprint
    FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
    LEFT JOIN question_proofreading m ON m.question_id=q.id
    WHERE q.kind='exam' AND qs.visibility='public' AND ${where} ORDER BY q.id LIMIT ${limit}
  ), bounded AS (SELECT *,sum(octet_length(COALESCE(image_data_url,''))+octet_length(COALESCE(images::text,''))) OVER () AS image_bytes FROM selected)
  SELECT id,question_set_id,question_number,subject,question,option_a,option_b,option_c,option_d,option_e,answer,
    explanation,explanation_status,explanation_version,exam_year,exam_subject,name,filename,file_hash,proofreading_version,image_fingerprint,image_bytes,
    CASE WHEN image_bytes<=${maxBatchBytes} THEN image_data_url END AS image_data_url,
    CASE WHEN image_bytes<=${maxBatchBytes} THEN images END AS images FROM bounded`,values);
}
function originals(q:Row):string[]{
  if(Number(q.image_bytes)>maxBatchBytes)throw new QuestionAdminError('本批圖片超過 32 MiB 讀取上限，請減少匯出題數',413);
  const composite=String(q.image_data_url??'');
  const images=q.image_fingerprint===md5(composite)&&Array.isArray(q.images)?q.images:composite?[composite]:[];
  if(images.length>8||images.some(i=>typeof i!=='string'||i.length>maxImageChars||!imagePattern.test(i)))throw new QuestionAdminError(`題目 #${q.id} 原圖格式無法安全匯出，請先人工核對；未略過此題`);
  if(composite&&!images.length)throw new QuestionAdminError(`題目 #${q.id} 原圖索引不完整，請先人工核對`);
  return images as string[];
}
function sourceFingerprint(q:Row,images:string[]){return digest(['vetexam-source-snapshot-v1',questionFingerprint(q),q.exam_subject??null,q.name??null,q.filename??null,q.file_hash??null,q.proofreading_version,images.map(digest),unknownSource]);}
function describe(q:Row,assets:Map<string,HandoffAsset>):HandoffQuestion{
  const images=originals(q),source=sourceFingerprint(q,images),answers=answerKeys(q.answer);
  const options=Object.fromEntries(letters.map(k=>[k,q['option_'+k.toLowerCase()]??null])) as HandoffQuestion['options'];
  const reasons:string[]=[];
  if(!String(q.question??'').trim())reasons.push('題幹空白');
  if(!answers.length)reasons.push('答案未知或為特殊答案，需人工核對');
  const present=letters.filter(k=>options[k]?.trim());
  if(present.length<2||present.some((k,i)=>k!==letters[i]))reasons.push('選項缺漏或不連續');
  if(answers.some(k=>!options[k as keyof typeof options]?.trim()))reasons.push('答案指向缺漏選項');
  if(answers.length&&answers.length===present.length)reasons.push('全部選項皆接受，可能為全給分題，需人工核對');
  const year=q.exam_year==null?null:Number(q.exam_year);
  return {questionId:Number(q.id),questionSetId:Number(q.question_set_id),questionSetName:String(q.name??''),
    rocYear:year==null?null:year>=1912?year-1911:year,exam_year:year,examSession:'unknown',
    examSubject:q.exam_subject as string|null,subject:q.subject as string|null,questionNumber:q.question_number==null?null:Number(q.question_number),
    question:String(q.question??''),options,officialAnswers:answers,rawAnswer:q.answer as string|null,
    answerPolicy:reasons.length?'manual_review':'any_accepted_option',manualReviewReasons:reasons,
    questionFingerprint:questionFingerprint(q),sourceFingerprint:source,
    sources:{...unknownSource,importFilename:q.filename as string|null,importFileHash:q.file_hash as string|null,proofreadingVersion:String(q.proofreading_version)},
    images:images.map((image,index)=>{const id=digest(image),mediaType=image.slice(5,image.indexOf(';')),extension=mediaType.split('/')[1];
      if(!assets.has(id))assets.set(id,{id,filename:`${id}.${extension}`,mediaType,requiresAdmin:true,
        downloadUrl:`/api/admin/questions/explanation/export?questionId=${q.id}&image=${index}&sourceFingerprint=${source}`});
      return {assetId:id,index};}),
  };
}
export async function exportQuestions(query:Query,params:URLSearchParams):Promise<QuestionHandoff>{
  if([...params.keys()].some(k=>!['questionSetId','limit','afterId'].includes(k)))throw new QuestionAdminError('匯出參數無效');
  const id=Number(params.get('questionSetId')),limit=Number(params.get('limit')??10),after=Number(params.get('afterId')??0);
  if(!validId(id)||!Number.isInteger(limit)||limit<1||limit>20||!Number.isInteger(after)||after<0||after>2147483647)throw new QuestionAdminError('請指定題庫 ID、1–20 題及有效的起始 ID');
  const rows=await readRows(query,"q.question_set_id=$1 AND q.id>$2 AND (q.explanation IS NULL OR q.explanation='') AND q.explanation_status='draft'",[id,after],limit);
  const assets=new Map<string,HandoffAsset>();
  const result:QuestionHandoff={formatVersion:EXPORT_FORMAT,exportedAt:new Date().toISOString(),questions:rows.map(q=>describe(q,assets)),assets:[...assets.values()],nextAfterId:rows.length===limit?Number(rows.at(-1)!.id):null,
    notice:'來源與梯次 unknown 代表尚無可靠資料。圖片引用需管理員登入下載原圖，再與 JSON 一併提供給 ChatGPT；不是公開連結。僅供內容核對，未儲存或發布解析。'};
  if(Buffer.byteLength(JSON.stringify(result))>IMPORT_FILE_BYTES)throw new QuestionAdminError('匯出內容超過 2 MiB，請減少題數',413);
  return result;
}
export async function exportImage(query:Query,params:URLSearchParams){
  if([...params.keys()].some(k=>!['questionId','image','sourceFingerprint'].includes(k)))throw new QuestionAdminError('圖片參數無效');
  const id=Number(params.get('questionId')),index=Number(params.get('image')),fingerprint=params.get('sourceFingerprint');
  if(!validId(id)||!Number.isInteger(index)||index<0||index>7||!fingerprint||!/^[a-f0-9]{64}$/.test(fingerprint))throw new QuestionAdminError('圖片參照無效');
  const [q]=await readRows(query,'q.id=$1',[id],1);if(!q)throw new QuestionAdminError('找不到公開國考題目',404);
  const images=originals(q);if(sourceFingerprint(q,images)!==fingerprint)throw new QuestionAdminError('題目或圖片來源版本已變更，請重新匯出',409);
  const image=images[index];if(!image)throw new QuestionAdminError('原圖不存在',404);
  const mediaType=image.slice(5,image.indexOf(';')),bytes=Buffer.from(image.slice(image.indexOf(',')+1),'base64');
  const valid=mediaType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mediaType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid)throw new QuestionAdminError('圖片內容與格式不符，請人工核對');
  return {bytes,mediaType,filename:`${digest(image)}.${mediaType.split('/')[1]}`};
}

const object=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
function exact(v:unknown,keys:string[],label:string):asserts v is Row{
  if(!object(v)||Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!(k in v)))throw new QuestionAdminError(`${label} 欄位缺漏或包含不允許的欄位`);
}
function text(v:unknown,label:string,max=6000){if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw new QuestionAdminError(`${label} 必須為非空白文字，最多 ${max} 字元`);}
export function parseStructured(value:unknown):StructuredExplanation{
  exact(value,['questionId','questionFingerprint','sourceFingerprint','expectedAnswers','explanationVersion','coreConcept','optionExplanations','correctAnswerReason','examMemory','extendedKnowledge','references','doubts','reviewStatus'],'解析');
  if(!validId(value.questionId))throw new QuestionAdminError('questionId 無效');
  for(const key of ['questionFingerprint','sourceFingerprint'])if(typeof value[key]!=='string'||!/^[a-f0-9]{64}$/.test(value[key] as string))throw new QuestionAdminError(`${key} 須為匯出時的 64 位 SHA-256`);
  if(value.explanationVersion!=='1.0'||value.reviewStatus!=='pending_review')throw new QuestionAdminError('解析版本須為 1.0，審核狀態只能是 pending_review');
  if(!Array.isArray(value.expectedAnswers)||!value.expectedAnswers.length||value.expectedAnswers.length>5||value.expectedAnswers.some(a=>!letters.includes(a))||new Set(value.expectedAnswers).size!==value.expectedAnswers.length)throw new QuestionAdminError('expectedAnswers 必須為不重複的 A–E 答案集合');
  for(const key of ['coreConcept','correctAnswerReason','examMemory','extendedKnowledge'])text(value[key],key);
  if(!object(value.optionExplanations)||!Object.keys(value.optionExplanations).length||Object.keys(value.optionExplanations).some(k=>!letters.includes(k as typeof letters[number])))throw new QuestionAdminError('各選項解析只允許 A–E');
  for(const [key,body] of Object.entries(value.optionExplanations))text(body,`選項 ${key} 解析`);
  if(!Array.isArray(value.references)||!value.references.length||value.references.length>10)throw new QuestionAdminError('須提供 1–10 筆引用；找不到依據時請標記疑義，不可補造文獻');
  const targets=['coreConcept','correctAnswerReason','examMemory','extendedKnowledge',...Object.keys(value.optionExplanations).map(k=>'optionExplanations.'+k)];
  for(const ref of value.references){
    exact(ref,['title','url','version','applicableYears','supports','statement','verificationStatus'],'引用');
    text(ref.title,'文獻名稱',500);text(ref.statement,'文獻對應敘述',2000);
    if(ref.version!==null)text(ref.version,'文獻版本',200);
    if(ref.verificationStatus!=='unverified')throw new QuestionAdminError('網址格式驗證不代表內容查證，verificationStatus 必須是 unverified');
    if(typeof ref.url!=='string'||ref.url.length>2048||!/^https?:\/\//i.test(ref.url)||/[\s<>\\\u0000-\u001f\u007f]/.test(ref.url))throw new QuestionAdminError('文獻網址只接受有效 HTTP／HTTPS');
    try{const url=new URL(ref.url);if(!url.hostname||url.username||url.password)throw Error();}catch{throw new QuestionAdminError('文獻網址無效');}
    if(ref.applicableYears!=='unknown'&&(!Array.isArray(ref.applicableYears)||!ref.applicableYears.length||ref.applicableYears.length>50||ref.applicableYears.some(y=>!Number.isInteger(y)||y<1||y>300)))throw new QuestionAdminError('適用年份須為民國年份陣列或 unknown');
    if(!Array.isArray(ref.supports)||!ref.supports.length||ref.supports.length>9||new Set(ref.supports).size!==ref.supports.length||ref.supports.some(s=>!targets.includes(s)))throw new QuestionAdminError('引用須指向實際存在的解析區塊');
  }
  if(!value.references.some(r=>r.supports.includes('correctAnswerReason')))throw new QuestionAdminError('正確答案理由缺少對應引用');
  if(!Array.isArray(value.doubts)||value.doubts.length>10)throw new QuestionAdminError('疑義標記最多 10 項');
  for(const doubt of value.doubts){exact(doubt,['code','detail'],'疑義');if(!['answer_dispute','all_credit','combined_choice','missing_reference','image_unclear','other'].includes(String(doubt.code)))throw new QuestionAdminError('疑義類型無效');text(doubt.detail,'疑義說明',2000);}
  return value as StructuredExplanation;
}
export function structuredMarkdown(item:StructuredExplanation){
  return `### 核心考點\n${item.coreConcept}\n\n### 正確答案理由\n${item.correctAnswerReason}\n\n### 各選項解析\n`+
    letters.filter(k=>item.optionExplanations[k]).map(k=>`#### ${k}\n${item.optionExplanations[k]}`).join('\n\n')+
    `\n\n### 國考速記\n${item.examMemory}\n\n### 延伸知識\n${item.extendedKnowledge}\n\n### 參考資料（內容尚未查核）\n`+
    item.references.map((r,i)=>`${i+1}. ${r.title}\n\n<${r.url}>\n\n版本：${r.version??'unknown'}；適用民國年份：${r.applicableYears==='unknown'?'unknown':r.applicableYears.join('、')}\n\n對應區塊：${r.supports.join('、')}\n\n對應敘述：${r.statement}`).join('\n\n')+
    (item.doubts.length?'\n\n### 疑義待人工審核\n'+item.doubts.map(d=>`- ${d.code}：${d.detail}`).join('\n'):'');
}
export async function previewHandoff(query:Query,input:unknown,userId:string){
  exact(input,['formatVersion','explanations'],'交接檔');
  if(input.formatVersion!==HANDOFF_FORMAT||!Array.isArray(input.explanations)||!input.explanations.length||input.explanations.length>20)throw new QuestionAdminError('新版格式須為 vetexam-explanations-v1，每批 1–20 題');
  if(Buffer.byteLength(JSON.stringify(input))>IMPORT_FILE_BYTES)throw new QuestionAdminError('JSON 檔案最多 2 MiB',413);
  const entries=input.explanations.map((value,index)=>{try{return {item:parseStructured(value),index};}catch(error){if(!(error instanceof QuestionAdminError))throw error;return {error:error.message,index,id:object(value)&&validId(value.questionId)?value.questionId:null};}});
  const ids=entries.flatMap(e=>e.item?[e.item.questionId]:[]);
  const rows=ids.length?await readRows(query,'q.id=ANY($1::int[])',[ids]):[];
  const byId=new Map(rows.map(q=>[Number(q.id),q]));
  const converted={explanations:entries.map(e=>e.item?{questionId:e.item.questionId,questionFingerprint:e.item.questionFingerprint,expectedAnswer:e.item.expectedAnswers,explanation:structuredMarkdown(e.item)}:{})};
  const legacy=await previewImport(query,parseImport(converted),userId);
  const previewRows:ExplanationImportRow[]=legacy.rows.map((row,index)=>{
    // No import capability is returned for the new format until Phase 3 persists version bindings.
    const {token:discarded,...view}=row;void discarded;
    const entry=entries[index],item=entry.item;if(!item)return {...view,questionId:entry.id??null,category:'invalid',reason:entry.error??'格式無效'};
    const q=byId.get(item.questionId);if(!q)return view;
    let question:HandoffQuestion;try{question=describe(q,new Map());}catch(error){if(!(error instanceof QuestionAdminError))throw error;return {...view,category:'invalid',reason:error.message};}
    if(question.sourceFingerprint!==item.sourceFingerprint)return {...view,category:'invalid',reason:'題目／圖片／來源快照已變更，請重新匯出並核對'};
    if(JSON.stringify(Object.keys(item.optionExplanations).sort())!==JSON.stringify(letters.filter(k=>question.options[k]?.trim())))return {...view,category:'invalid',reason:'必須逐一提供原題所有實際選項解析，不得缺漏或新增選項'};
    if(question.manualReviewReasons.length||item.doubts.length)return {...view,category:'invalid',reason:'需人工處理：'+[...question.manualReviewReasons,...item.doubts.map(d=>d.code+'：'+d.detail)].join('；')};
    return view.category==='ready'?{...view,reason:'結構與版本核對通過；來源內容未查證，僅供預覽，未寫入'}:view;
  });
  return {handoffPreview:true,rows:previewRows,notice:'Phase 1／2 僅校驗預覽，未儲存草稿或發布。Phase 3 版本綁定與收據完成前，新版格式禁止匯入。'};
}
