import {requireAdmin} from '@/lib/admin';
import {aiJson,aiError,readAIBody} from '@/lib/ai-question-http';
import {questionTransaction} from '@/lib/question-transaction';
import {beginMaterialUpload,putMaterialChunk,finishMaterialUpload} from '@/lib/ai-material-upload';
import {uuid} from '@/lib/ai-question-input';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
export async function POST(request:Request){
  try{
    const admin=await requireAdmin(request);if(!admin)return aiJson({error:'僅管理員可使用'},403);
    const body=await readAIBody(request),userId=admin.session.user.id;
    if(body.action==='begin')return aiJson(await questionTransaction(client=>beginMaterialUpload(client,body,userId)));
    if(body.action==='chunk')return aiJson(await questionTransaction(client=>putMaterialChunk(client,body,userId)));
    if(body.action==='finish'&&uuid(body.id))return aiJson(await finishMaterialUpload(body.id,userId));
    return aiJson({error:'操作無效'},400);
  }catch(e){return aiError(e);}
}
