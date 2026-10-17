import {NextResponse} from 'next/server';
import {auth} from '@/lib/auth';
import {questionTransaction} from '@/lib/question-transaction';
import {DiagnosticError} from '@/lib/diagnostic-service';
import {readCoachReport,setCoachFocus} from '@/lib/coach-report-service';
import {EXAM_SUBJECTS} from '@/data/exam-chapters';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function handle(request:Request,write:boolean) {
 try {
  const origin=request.headers.get('origin');
  if(write&&((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site'))return json({error:'不允許此來源'},403);
  const session=await auth.api.getSession({headers:request.headers});
  if(!session?.user?.id)return json({error:'請先登入後使用國考教練。'},401);
  if(!write)return json(await questionTransaction(client=>readCoachReport(client,session.user.id)));
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return json({error:'請使用 JSON 格式'},415);
  const reader=request.body?.getReader();if(!reader)return json({error:'缺少偏好資料'},400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return json({error:'資料過大'},413);}chunks.push(value);}
  let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json({error:'JSON 格式錯誤'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('subject' in body)||(body.subject!==null&&(typeof body.subject!=='string'||!EXAM_SUBJECTS.includes(body.subject))))return json({error:'請選擇既有國考科目或交給教練安排'},400);
  const subject=body.subject as string|null;
  return json(await questionTransaction(client=>setCoachFocus(client,session.user.id,subject)));
 }catch(error){if(error instanceof DiagnosticError)return json({error:error.message},error.status);return json({error:'教練偏好或週報暫時無法讀取，請重試確認。'},503);}
}
export async function GET(request:Request){return handle(request,false);}
export async function PUT(request:Request){return handle(request,true);}
