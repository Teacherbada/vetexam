import { auth } from '@/lib/auth';
import { questionTransaction } from '@/lib/question-transaction';
import { readDueReview } from '@/lib/due-review-service';
import { reviewLimit } from '@/lib/due-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user.id) return response({ error: '請先登入' }, 401);
    const limit = reviewLimit(new URL(request.url).searchParams.get('limit'));
    if (limit === null) return response({ error: '題數只支援 5、10、20、30、50 題。' }, 400);
    return response(await questionTransaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      return readDueReview(client, session.user.id, limit);
    }));
  } catch { return response({ error: '到期複習暫時無法讀取，請稍後重試。' }, 503); }
}
