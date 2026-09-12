import { requireAdmin } from '@/lib/admin';
import { parseInput } from '@/lib/admin-question-input';
import { applyAnswers, buildPreview, issuePreviewToken, QuestionAdminError } from '@/lib/admin-questions';
import { adminError, adminJson, readAdminBody } from '@/lib/admin-question-http';
import { questionTransaction } from '@/lib/question-transaction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return adminJson({ error: '僅限管理員使用' }, 403);
    const body = await readAdminBody(request);
    if (Object.keys(body).some(key => !['action', 'input', 'token', 'confirm_statistics', 'confirm_removal'].includes(key))) throw new QuestionAdminError('不支援的欄位');
    let input;
    try { input = parseInput(body.input); }
    catch (error) { throw new QuestionAdminError(error instanceof Error ? error.message : '答案格式錯誤'); }
    if (body.action === 'preview') {
      const preview = await questionTransaction(async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        return buildPreview(async (text, values) => (await client.query(text, values)).rows, input);
      });
      return adminJson({ ...preview, token: preview.can_apply ? issuePreviewToken(preview.fingerprint, admin.session.user.id) : null });
    }
    if (body.action !== 'apply') throw new QuestionAdminError('請先解析預覽，再確認套用答案');
    const summary = await questionTransaction(client => applyAnswers(client, input, body.token, admin.session.user.id, body.confirm_statistics === true, body.confirm_removal === true));
    return adminJson({ success: true, summary });
  } catch (error) { return adminError(error); }
}
