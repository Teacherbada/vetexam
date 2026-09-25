import { neon } from '@neondatabase/serverless';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    if (!process.env.DATABASE_URL) throw new Error('unavailable');
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT q.subject,q.chapter,qs.exam_year AS year,qs.id AS paper,COUNT(*)::int AS count
      FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id WHERE qs.visibility='public'
      GROUP BY q.subject,q.chapter,qs.exam_year,qs.id`;
    return Response.json({ rows }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch { return Response.json({ error: '出題頻率暫時無法讀取' }, { status: 503 }); }
}
