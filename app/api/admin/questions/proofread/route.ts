import {requireAdmin} from '@/lib/admin';
import {adminJson,adminError,readAdminBody} from '@/lib/admin-question-http';
import {QuestionAdminError} from '@/lib/admin-questions';
import {questionTransaction} from '@/lib/question-transaction';
import {proofBanks,proofBank,proofDetail,proofImage,proofHistory,changeProof} from '@/lib/question-proofreading';
import {PROOF_BODY_LIMIT,validProofId,validRevision} from '@/lib/question-proofreading-input';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
  const admin=await requireAdmin(request);if(!admin)return adminJson({error:'僅限管理員使用'},403);
  const query=(t:string,v:unknown[])=>admin.sql.query(t,v),p=new URL(request.url).searchParams;
  if(p.has('id')){
    const id=Number(p.get('id'));if(!validProofId(id))throw new QuestionAdminError('題目 ID 無效');
    if(p.has('image')){
      const index=Number(p.get('image')),revision=p.get('revision');
      if(!Number.isInteger(index)||index<0||index>=8||!validRevision(revision))throw new QuestionAdminError('圖片參照無效');
      const src=await proofImage(query,id,index,revision),comma=src.indexOf(',');
      return new Response(Buffer.from(src.slice(comma+1),'base64'),{headers:{'Content-Type':src.slice(5,src.indexOf(';')),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});
    }
    const historyId=p.has('historyId')?Number(p.get('historyId')):undefined;
    if(historyId!==undefined&&!validProofId(historyId))throw new QuestionAdminError('歷史版本無效');
    return adminJson(p.has('history')?{history:await proofHistory(query,id,historyId)}:await proofDetail(query,id));
  }
  if(p.has('bankId')){const id=Number(p.get('bankId'));if(!validProofId(id))throw new QuestionAdminError('考卷 ID 無效');return adminJson(await proofBank(query,id));}
  return adminJson({banks:await proofBanks(query)});
}catch(e){return adminError(e);}}
export async function PATCH(request:Request){try{
  const admin=await requireAdmin(request);if(!admin)return adminJson({error:'僅限管理員使用'},403);
  const body=await readAdminBody(request,PROOF_BODY_LIMIT);
  return adminJson(await questionTransaction(client=>changeProof(client,body,admin.session.user.id)));
}catch(e){return adminError(e);}}
