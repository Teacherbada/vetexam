import { requireAdmin } from '@/lib/admin';
import { questionTransaction } from '@/lib/question-transaction';
import { signedAIPreview, importAI, updateAI } from '@/lib/ai-question-service';
import { aiJson, aiError, readAIBody } from '@/lib/ai-question-http';
import { uuid } from '@/lib/ai-question-input';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return aiJson({ error: '僅管理員可使用' }, 403);
    const params = new URL(request.url).searchParams;
    const batch = params.get('batch');
    if (batch) {
      if (!uuid(batch)) return aiJson({ error: '批次無效' }, 400);
      const questions = await admin.sql.query('SELECT * FROM ai_questions WHERE batch_id=$1 ORDER BY position', [batch]);
      return aiJson({ questions });
    }
    const after = params.get('after') || '';
    if (after && !uuid(after)) return aiJson({ error: '分頁無效' }, 400);
    const rows = await admin.sql.query("SELECT b.id,b.name,b.created_at,b.result,COUNT(q.id)::int AS total,COUNT(q.id) FILTER(WHERE q.status='draft')::int AS drafts,COUNT(q.id) FILTER(WHERE q.status='published')::int AS published FROM ai_question_batches b LEFT JOIN ai_questions q ON q.batch_id=b.id WHERE ($1::uuid IS NULL OR (b.created_at,b.id)<(SELECT created_at,id FROM ai_question_batches WHERE id=$1::uuid)) GROUP BY b.id ORDER BY b.created_at DESC,b.id DESC LIMIT 51", [after || null]);
    return aiJson({ batches: rows.slice(0,50), next: rows.length > 50 ? rows[49].id : null });
  } catch (e) { return aiError(e); }
}
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return aiJson({ error: '僅管理員可使用' }, 403);
    const body = await readAIBody(request);
    if (body.action === 'preview') return aiJson(await signedAIPreview(async (sql, values) => admin.sql.query(sql, values), body.input, admin.session.user.id));
    if (body.action === 'import') return aiJson(await questionTransaction(client => importAI(client, body, admin.session.user.id)));
    if (['save','publish','unpublish'].includes(String(body.action))) return aiJson({ question: await questionTransaction(client => updateAI(client, body, admin.session.user.id)) });
    return aiJson({ error: '操作無效' }, 400);
  } catch (e) { return aiError(e); }
}
