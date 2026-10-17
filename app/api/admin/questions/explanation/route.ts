import { requireAdmin } from '@/lib/admin';
import { adminError, adminJson, readAdminBody } from '@/lib/admin-question-http';
import { explanationId, parseExplanation, readExplanation, saveExplanation } from '@/lib/official-explanation';
import { questionTransaction } from '@/lib/question-transaction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return adminJson({ error: '僅限管理員使用' }, 403);
    const id = explanationId(Number(new URL(request.url).searchParams.get('id')));
    return adminJson(await readExplanation((text, values) => admin.sql.query(text, values), id));
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  try {
    const admin=await requireAdmin(request);
    if (!admin) return adminJson({ error: '僅限管理員使用' }, 403);
    const input = parseExplanation(await readAdminBody(request));
    return adminJson(await questionTransaction(client => saveExplanation(client, input,admin.session.user.id)));
  } catch (error) { return adminError(error); }
}
