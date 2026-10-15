import { answerKeys, serializeAnswer } from './question-answer';

export const PROOF_BODY_LIMIT = 3_800_000;
export const PROOF_IMAGE_LIMIT = 8;
export type ImageReference = { questionId: number; index: number; revision: string };
export type ImageInput = ImageReference | { dataUrl: string };
export type ProofContent = { question: string; options: string[]; answer: string; explanation: string };
export type ProofRow = ProofContent & { id: number; number: number; revision: string; reviewed: boolean; hasImage: boolean; imageCount: number; issues: string[] };
export const validProofId = (id: unknown): id is number => Number.isInteger(id) && Number(id)>0 && Number(id)<=2147483647;
export const validRevision = (v: unknown): v is string => typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
export function proofInput(value: Record<string, unknown>) {
  const allowed=['action','id','bankId','revision','requestId','question','options','answer','explanation','images','confirmAnswer','confirmExplanation','confirmWarnings','recalculateStats','historyId'];
  if(Object.keys(value).some(k=>!allowed.includes(k)))throw Error('含不允許的欄位；不可變更題號、年度、科目或題庫歸屬。');
  if(!['save','review','unreview','restore','complete'].includes(String(value.action)) || !validRevision(value.revision))throw Error('操作或版本無效，請重新載入。');
  if(value.action==='complete'){if(!validProofId(value.bankId))throw Error('考卷 ID 無效');return value;}
  if(!validProofId(value.id)||typeof value.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.requestId))throw Error('題目或操作識別碼無效');
  if(value.action==='restore'&&!validProofId(value.historyId))throw Error('歷史版本無效');
  if(value.action!=='save')return value;
  if(typeof value.question!=='string'||!value.question.trim()||value.question.length>20000||value.question.includes('\0'))throw Error('題幹不可空白，最多 20,000 字元');
  if(!Array.isArray(value.options)||value.options.length<2||value.options.length>5||value.options.some(o=>typeof o!=='string'||!o.trim()||o.length>10000||o.includes('\0')))throw Error('請保留 2～5 個非空白選項，每個最多 10,000 字元');
  const answer = value.answer==='' ? '' : serializeAnswer(value.answer,true);
  const options=value.options as string[];
  if(answer===null||answerKeys(answer).some(a=>!options[a.charCodeAt(0)-65]))throw Error('答案只能指向實際存在的 A–E 選項');
  if(typeof value.explanation!=='string'||value.explanation.length>20000||value.explanation.includes('\0'))throw Error('解析最多 20,000 字元');
  if(!Array.isArray(value.images)||value.images.length>PROOF_IMAGE_LIMIT)throw Error('每題最多 8 張圖片');
  for(const image of value.images){
    if(!image||typeof image!=='object'||Array.isArray(image))throw Error('圖片格式無效');
    if('dataUrl' in image){if(Object.keys(image).join()!=='dataUrl'||typeof image.dataUrl!=='string'||image.dataUrl.length>2_800_000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.dataUrl))throw Error('新圖片只接受 2 MB 以內的 PNG、JPEG 或 WebP');}
    else if(Object.keys(image).sort().join()!=='index,questionId,revision'||!validProofId(image.questionId)||!Number.isInteger(image.index)||image.index<0||image.index>=8||!validRevision(image.revision))throw Error('圖片參照無效');
  }
  return {...value,answer};
}

export function questionIssues(q: ProofContent & {hasImage?:boolean;imageValid?:boolean}) {
  const issues:string[]=[];const keys=answerKeys(q.answer);
  if(!q.question.trim())issues.push('題幹空白');
  else if(q.question.trim().length<8||/[：:,，]$/.test(q.question.trim()))issues.push('題幹疑似截斷，請核對原題');
  if(!keys.length)issues.push('未設定有效答案');
  else if(keys.some(a=>!q.options[a.charCodeAt(0)-65]?.trim()))issues.push('答案指向不存在的選項');
  if(q.options.length>4)issues.push('有 E 選項，請確認是否為原題內容');
  if(q.options.length<2||q.options.some(o=>!o.trim()))issues.push('選項空白');
  const options=q.options.map(o=>o.trim()).filter(Boolean);if(new Set(options).size!==options.length)issues.push('選項文字完全重複');
  if(q.imageValid===false)issues.push('圖片資料無效或引用遺失');
  const match=/(?:正確答案|官方答案|答案)\s*[：:]\s*\**([A-E](?:[、,，/\s]+[A-E])*)/i.exec(q.explanation);
  if(match&&serializeAnswer(match[1],true)!==serializeAnswer(q.answer,true))issues.push('解析標示答案與官方答案可能不一致');
  return issues;
}
export function numberingIssues(rows:{number:number}[],expected:number){
  const counts=new Map<number,number>();rows.forEach(q=>counts.set(q.number,(counts.get(q.number)||0)+1));
  const duplicate=[...counts].filter(([,n])=>n>1).map(([n])=>n);
  const end=Math.max(expected,...rows.map(r=>r.number),0);const missing:number[]=[];
  for(let n=1;n<=Math.min(end,2000);n++)if(!counts.has(n))missing.push(n);
  return {duplicate,missing,valid:expected>0&&rows.length===expected&&!duplicate.length&&!missing.length&&end===expected};
}
