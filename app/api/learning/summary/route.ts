import { auth } from '@/lib/auth';
import { questionTransaction } from '@/lib/question-transaction';
import { readLearningSummary } from '@/lib/learning-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user.id) return response({ owner: null });
    return response(await questionTransaction(client => readLearningSummary(client, session.user.id)));
  } catch { return response({ error: '帳號摘要暫時無法讀取，請稍後重試。' }, 503); }
}
