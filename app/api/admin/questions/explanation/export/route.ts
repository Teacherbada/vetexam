import {requireAdmin} from '@/lib/admin';
import {adminError,adminJson} from '@/lib/admin-question-http';
import {exportQuestions,exportImage} from '@/lib/explanation-handoff';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  try{
    const admin=await requireAdmin(request);
    if(!admin)return adminJson({error:'僅限管理員使用'},403);
    const query=(text:string,values:unknown[])=>admin.sql.query(text,values);
    const params=new URL(request.url).searchParams;
    if(params.has('image')){
      const image=await exportImage(query,params);
      return new Response(new Uint8Array(image.bytes),{headers:{'Content-Type':image.mediaType,'Content-Disposition':`attachment; filename="${image.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
    }
    return adminJson(await exportQuestions(query,params));
  }catch(error){return adminError(error);}
}
