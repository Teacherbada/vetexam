import { neon } from '@neondatabase/serverless';
import { questionDifficulty } from '@/lib/question-difficulty';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('questionId');
  const id = Number(raw);
  if (!raw || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(id) || id > 2147483647) return Response.json({ error: '題目編號錯誤' }, { status: 400 });
  try {
    if (!process.env.DATABASE_URL) throw new Error('unavailable');
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT COUNT(s.id)::int AS total,COUNT(s.id) FILTER(WHERE s.is_correct)::int AS correct
      FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id
      LEFT JOIN question_answer_stats s ON s.question_id=q.id
      WHERE q.id=${id} AND qs.visibility='public' GROUP BY q.id`;
    if (!rows.length) return Response.json({ error: '找不到公開題目' }, { status: 404 });
    return Response.json(questionDifficulty(rows[0].total,rows[0].correct), { headers: { 'Cache-Control':'no-store' } });
  } catch { return Response.json({ error: '難度統計暫時無法讀取' }, { status: 503 }); }
}
