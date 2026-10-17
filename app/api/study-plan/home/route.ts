import {auth} from '@/lib/auth';
import {questionTransaction} from '@/lib/question-transaction';
import {readHomeCoach} from '@/lib/home-coach-service';
import {ensureDailyTask} from '@/lib/daily-task-service';
import {DiagnosticError} from '@/lib/diagnostic-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function handle(request:Request,start:boolean){
 try{
  const origin=request.headers.get('origin');
  if(start&&((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site'))return json({error:'不允許此來源'},403);
  const session=await auth.api.getSession({headers:request.headers});
  if(!session?.user?.id)return json({owner:null,enabled:false,task:null},401);
  return json(await questionTransaction(async client=>{
   const current=await readHomeCoach(client,session.user.id);
   if(!start||!current.enabled||current.task)return current;
   const daily=await ensureDailyTask(client,session.user.id);
   return {...await readHomeCoach(client,session.user.id),diagnostic:daily.coach?.diagnostic??null};
  }));
 }catch(error){if(error instanceof DiagnosticError)return json({error:error.message},error.status);return json({error:'今日教練暫時無法更新，請重新載入。'},503);}
}
export async function GET(request:Request){return handle(request,false);}
export async function POST(request:Request){return handle(request,true);}
