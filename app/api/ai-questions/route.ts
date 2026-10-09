import { neon } from '@neondatabase/serverless';
import { auth } from '@/lib/auth';
import { questionTransaction } from '@/lib/question-transaction';
import { listPublishedAI, answerAI } from '@/lib/ai-question-service';
import { aiJson, aiError, readAIBody } from '@/lib/ai-question-http';
import { EXAM_SUBJECTS, validChapter } from '@/data/exam-chapters';
import { uuid } from '@/lib/ai-question-input';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return aiJson({ error: '請先登入會員' }, 401);
    const params = new URL(request.url).searchParams;
    const subject = params.get('subject') || '', chapter = params.get('chapter') || '', after = params.get('after') || '';
    if ((subject && !EXAM_SUBJECTS.includes(subject)) || !validChapter(subject, chapter) || (after && !uuid(after))) return aiJson({ error: '分類或分頁無效' }, 400);
    if (!process.env.DATABASE_URL) throw new Error('Database unavailable');
    const sql = neon(process.env.DATABASE_URL);
    const rows = await listPublishedAI(async (text, values) => sql.query(text, values), subject, chapter, after);
    return aiJson({ questions: rows.slice(0,50), next: rows.length > 50 ? rows[49].id : null });
  } catch (e) { return aiError(e); }
}
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return aiJson({ error: '請先登入會員' }, 401);
    const body = await readAIBody(request);
    return aiJson(await questionTransaction(client => answerAI(client, body, session.user.id)));
  } catch (e) { return aiError(e); }
}
