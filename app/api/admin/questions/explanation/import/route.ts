import { requireAdmin } from '@/lib/admin';
import { adminError, adminJson, readAdminBody } from '@/lib/admin-question-http';
import { QuestionAdminError } from '@/lib/admin-questions';
import { parseImport, previewImport, parseSelections } from '@/lib/featured-explanation-import';
import { questionTransaction } from '@/lib/question-transaction';
import { previewHandoff } from '@/lib/explanation-handoff';
import {safeExplanationImport,readImportReceipt} from '@/lib/explanation-safe-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request:Request){
  try{
    const admin=await requireAdmin(request);
    if(!admin)return adminJson({error:'僅限管理員使用'},403);
    return adminJson(await readImportReceipt((text,values)=>admin.sql.query(text,values),admin.session.user.id,new URL(request.url).searchParams.get('receiptId')??''));
  }catch(error){return adminError(error);}
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return adminJson({ error: '僅限管理員使用' }, 403);
    const body = await readAdminBody(request, 3 * 1024 * 1024);
    if (Object.keys(body).some(key => !['action', 'input', 'selected','requestId'].includes(key))) throw new QuestionAdminError('匯入操作欄位無效');
    if (body.input && typeof body.input === 'object' && 'formatVersion' in body.input) {
      if(body.action==='preview')return adminJson(await previewHandoff((text, values) => admin.sql.query(text, values), body.input, admin.session.user.id));
      if(body.action!=='import')throw new QuestionAdminError('匯入操作無效');
      try{return adminJson(await questionTransaction(client=>safeExplanationImport(client,body.input,body.selected,admin.session.user.id,body.requestId)));}
      catch(error){
        const response=adminError(error);if(response.status!==503)return response;
        const raw=(body.input as {explanations?:unknown[]}).explanations;
        const chosen=new Set(Array.isArray(body.selected)?body.selected.map(s=>s?.index):[]);
        return adminJson({error:'交易結果尚未確認，請用原識別碼重試或查看收據；不會重複寫入。',requestId:body.requestId,
          rows:Array.isArray(raw)?raw.map((item,index)=>({index,questionId:item&&typeof item==='object'&&'questionId' in item?item.questionId:null,
            status:chosen.has(index)?'unconfirmed':'skipped',reason:chosen.has(index)?'請查詢收據或重試確認交易結果':'未勾選'})):[]},503);
      }
    }
    const entries = parseImport(body.input);
    if (body.action === 'preview') return adminJson(await previewImport((text, values) => admin.sql.query(text, values), entries, admin.session.user.id));
    if (body.action !== 'import') throw new QuestionAdminError('匯入操作無效');
    const selected = parseSelections(body.selected, entries);
    try {
      return adminJson(await questionTransaction(client => safeExplanationImport(client, body.input, selected, admin.session.user.id,body.requestId)));
    } catch (error) {
      // A SQL failure rolls back; a lost COMMIT response may need receipt recovery.
      const failed = new Set(selected.map(item => item.index));
      const response = adminError(error);
      const { error: reason } = await response.json();
      return adminJson({ error: reason, success: 0, failed: selected.length, skipped: entries.length - selected.length,
        rows: entries.map(entry => ({ index: entry.row.index, questionId: entry.row.questionId,
          status: failed.has(entry.row.index) ? 'failed' : 'skipped', reason: failed.has(entry.row.index) ? '交易未確認，請查看收據或用原識別碼重試：' + reason : '未勾選' })) }, response.status);
    }
  } catch (error) { return adminError(error); }
}
