import { randomUUID } from 'node:crypto';
import { requireAdmin } from '@/lib/admin';
import { questionTransaction } from '@/lib/question-transaction';
import { QuestionAdminError } from '@/lib/admin-questions';
import { aiJson, aiError, readAIBody } from '@/lib/ai-question-http';
import { uuid } from '@/lib/ai-question-input';
import { MATERIAL_LIMITS } from '@/lib/ai-material-input';
import { extractMaterialPDF } from '@/lib/ai-material-pdf';
import { saveMaterial, estimateMaterial, startMaterialJob, stepMaterialJob } from '@/lib/ai-material-service';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request: Request) {
  try {
    const admin=await requireAdmin(request); if (!admin) return aiJson({error:'僅管理員可使用'},403);
    const params=new URL(request.url).searchParams, materialId=params.get('material'), jobId=params.get('job');
    if (materialId) {
      if (!uuid(materialId)) throw new QuestionAdminError('教材識別碼無效');
      // Bytea is read through pg, never encoded into JSON or exposed to member endpoints.
      const material=await questionTransaction(async c=>(await c.query('SELECT id,filename,pages,octet_length(pdf) AS byte_length FROM ai_materials WHERE id=$1',[materialId])).rows[0]);
      if (!material) throw new QuestionAdminError('找不到教材',404);
      if (params.has('pdf')) {
        const part=params.get('part');
        if(part===null && material.byte_length>MATERIAL_LIMITS.directFileBytes)return new Response(null,{status:307,headers:{Location:'/admin/ai-materials/source?material='+materialId,'Cache-Control':'private, no-store'}});
        if(part!==null&&(!/^\d+$/.test(part)||Number(part)>=Math.ceil(material.byte_length/MATERIAL_LIMITS.chunkBytes)))throw new QuestionAdminError('教材分段無效');
        const start=part===null?0:Number(part)*MATERIAL_LIMITS.chunkBytes,length=part===null?MATERIAL_LIMITS.directFileBytes:MATERIAL_LIMITS.chunkBytes;
        const bytes=await questionTransaction(async c=>(await c.query('SELECT substring(pdf FROM $2::int FOR $3::int) AS bytes FROM ai_materials WHERE id=$1',[materialId,start+1,length])).rows[0].bytes);
        return new Response(new Uint8Array(bytes),{headers:{'Content-Type':part===null?'application/pdf':'application/octet-stream','Content-Disposition':'inline; filename="material.pdf"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; frame-ancestors 'self'"}});
      }
      return aiJson({material});
    }
    if (jobId) {
      if (!uuid(jobId)) throw new QuestionAdminError('工作識別碼無效');
      const job=(await admin.sql.query('SELECT id,batch_id,spec,model,reserved_micro_usd,created_at FROM ai_generation_jobs WHERE id=$1',[jobId]))[0];
      if (!job) throw new QuestionAdminError('找不到工作',404);
      const items=await admin.sql.query('SELECT position,status,started_at,finished_at,error,question_id,usage,actual_micro_usd FROM ai_generation_items WHERE job_id=$1 ORDER BY position',[jobId]);
      return aiJson({job,items});
    }
    const jobs=await admin.sql.query('SELECT id,batch_id,spec,created_at FROM ai_generation_jobs ORDER BY created_at DESC LIMIT 100');
    const materials=await admin.sql.query('SELECT id,filename,created_at FROM ai_materials ORDER BY created_at DESC LIMIT 100');
    return aiJson({jobs,materials,limits:MATERIAL_LIMITS,keyConfigured:!!process.env.OPENAI_API_KEY?.trim()});
  } catch(e) { return aiError(e); }
}
export async function POST(request: Request) {
  try {
    const admin=await requireAdmin(request); if (!admin) return aiJson({error:'僅管理員可使用'},403);
    if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const origin=request.headers.get('origin');
      if ((origin && origin!==new URL(request.url).origin) || request.headers.get('sec-fetch-site')==='cross-site') throw new QuestionAdminError('不允許此來源',403);
      const reader=request.body?.getReader(); if (!reader) throw new QuestionAdminError('缺少 PDF');
      const chunks: Uint8Array[]=[]; let size=0;
      while (true) {const {done,value}=await reader.read(); if (done) break; size+=value.byteLength; if (size>MATERIAL_LIMITS.directFileBytes+65536) {await reader.cancel();throw new QuestionAdminError('大於 3 MB 請使用教材分段上傳（最多 100 MB）',413);} chunks.push(value);}
      const form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('content-type')!}}).formData(), file=form.get('file');
      if (!(file instanceof File) || file.size>MATERIAL_LIMITS.directFileBytes) throw new QuestionAdminError('大於 3 MB 請使用教材分段上傳（最多 100 MB）');
      const bytes=Buffer.from(await file.arrayBuffer());
      let pages; try { pages=await extractMaterialPDF(new Uint8Array(bytes)); } catch(e) { throw new QuestionAdminError('無法擷取教材：'+((e as Error).message.includes('password')?'PDF 已加密，請先解除密碼':(e as Error).message)); }
      const material=await questionTransaction(client=>saveMaterial(client,bytes,file.name || randomUUID()+'.pdf',pages,admin.session.user.id));
      return aiJson({material}); // No AI call in upload or preview.
    }
    const body=await readAIBody(request);
    if (body.action==='estimate') { const estimate=await questionTransaction(client=>estimateMaterial(client,body.spec)); return aiJson({estimateMicroUSD:estimate.cost,model:MATERIAL_LIMITS.model}); }
    if (body.action==='start') return aiJson(await questionTransaction(client=>startMaterialJob(client,body,admin.session.user.id)));
    if (body.action==='step' && uuid(body.jobId)) return aiJson(await stepMaterialJob(body.jobId));
    return aiJson({error:'操作無效'},400);
  } catch(e) {return aiError(e);}
}
