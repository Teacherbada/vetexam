import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { questionTransaction } from '@/lib/question-transaction';
import { DiagnosticError } from '@/lib/diagnostic-service';
import { answerDailyTask, ensureDailyTask, readDailyTask, setDailyTarget } from '@/lib/daily-task-service';
import { validDailyTarget } from '@/lib/daily-task';
import { DAILY_TARGET_MAX } from '@/lib/daily-task-config';
import { validTaskId } from '@/lib/reinforcement';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown,status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function handle(request: Request,action: 'read'|'start'|'target'|'answer') {
  try {
    const origin=request.headers.get('origin');
    if (action!=='read' && ((origin && origin!==new URL(request.url).origin) || request.headers.get('sec-fetch-site')==='cross-site')) return json({error:'不允許此來源'},403);
    const session=await auth.api.getSession({headers:request.headers});
    if (!session?.user?.id) return json({error:'請先登入後使用每日任務。'},401);
    const userId=session.user.id;
    if (action==='read') return json(await questionTransaction(client=>readDailyTask(client,userId)));
    if (action==='start') return json(await questionTransaction(client=>ensureDailyTask(client,userId)));
    if (request.headers.get('content-type')?.split(';')[0].trim()!=='application/json') return json({error:'請使用 JSON 格式'},415);
    const reader=request.body?.getReader(); if (!reader) return json({error:'缺少任務資料'},400);
    const chunks: Uint8Array[]=[]; let size=0;
    while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>1024) {await reader.cancel();return json({error:'任務資料過大'},413);} chunks.push(value); }
    let body: unknown;
    try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {return json({error:'資料格式錯誤'},400);}
    if (!body || typeof body!=='object' || Array.isArray(body)) return json({error:'資料格式錯誤'},400);
    const row=body as Record<string,unknown>;
    if (action==='target') {
      if(Object.keys(row).length!==1 || !validDailyTarget(row.target)) return json({error:'每日題數無效'},400);
      const target=row.target;
      return json(await questionTransaction(client=>setDailyTarget(client,userId,target)));
    }
    if(Object.keys(row).length!==3 || !validTaskId(row.taskId) || !Number.isInteger(row.position) || Number(row.position)<1 || Number(row.position)>DAILY_TARGET_MAX || typeof row.answer!=='string' || !/^[A-E]$/.test(row.answer)) return json({error:'作答資料無效'},400);
    const submission={taskId:row.taskId,position:Number(row.position),answer:row.answer};
    return json(await questionTransaction(client=>answerDailyTask(client,userId,submission)));
  } catch(error) {
    if(error instanceof DiagnosticError) return json({error:error.message},error.status);
    return json({error:'每日任務暫時無法連線，請重新載入確認已儲存進度。'},503);
  }
}
export async function GET(request: Request) {return handle(request,'read');}
export async function POST(request: Request) {return handle(request,'start');}
export async function PATCH(request: Request) {return handle(request,'target');}
export async function PUT(request: Request) {return handle(request,'answer');}
