import { requireAdmin } from '@/lib/admin';
import { adminError, adminJson, readAdminBody } from '@/lib/admin-question-http';
import { readChapterQueue, updateQuestionChapter } from '@/lib/admin-question-chapters';
import { questionTransaction } from '@/lib/question-transaction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return adminJson({ error: '僅限管理員使用' }, 403);
    return adminJson(await readChapterQueue((text, values) => admin.sql.query(text, values), new URL(request.url).searchParams));
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return adminJson({ error: '僅限管理員使用' }, 403);
    const body = await readAdminBody(request);
    return adminJson(await questionTransaction(client => updateQuestionChapter(client, body)));
  } catch (error) { return adminError(error); }
}
