import { requireAdmin } from '@/lib/admin';
import { adminError, adminJson, readAdminBody } from '@/lib/admin-question-http';
import { QuestionAdminError } from '@/lib/admin-questions';
import { parseImport, previewImport, parseSelections, applyImport } from '@/lib/featured-explanation-import';
import { questionTransaction } from '@/lib/question-transaction';
import { previewHandoff } from '@/lib/explanation-handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return adminJson({ error: '僅限管理員使用' }, 403);
    const body = await readAdminBody(request, 3 * 1024 * 1024);
    if (Object.keys(body).some(key => !['action', 'input', 'selected'].includes(key))) throw new QuestionAdminError('匯入操作欄位無效');
    if (body.input && typeof body.input === 'object' && 'formatVersion' in body.input) {
      if (body.action !== 'preview') throw new QuestionAdminError('新版解析交接目前僅供校驗預覽；尚未啟用寫入或發布', 409);
      return adminJson(await previewHandoff((text, values) => admin.sql.query(text, values), body.input, admin.session.user.id));
    }
    const entries = parseImport(body.input);
    if (body.action === 'preview') return adminJson(await previewImport((text, values) => admin.sql.query(text, values), entries, admin.session.user.id));
    if (body.action !== 'import') throw new QuestionAdminError('匯入操作無效');
    const selected = parseSelections(body.selected, entries);
    try {
      return adminJson(await questionTransaction(client => applyImport(client, entries, selected, admin.session.user.id)));
    } catch (error) {
      // A database failure rolls back ALL writes in this transaction. Never report false successes.
      const failed = new Set(selected.map(item => item.index));
      const response = adminError(error);
      const { error: reason } = await response.json();
      return adminJson({ error: reason, success: 0, failed: selected.length, skipped: entries.length - selected.length,
        rows: entries.map(entry => ({ index: entry.row.index, questionId: entry.row.questionId,
          status: failed.has(entry.row.index) ? 'failed' : 'skipped', reason: failed.has(entry.row.index) ? '整筆交易已回復：' + reason : '未勾選' })) }, response.status);
    }
  } catch (error) { return adminError(error); }
}
