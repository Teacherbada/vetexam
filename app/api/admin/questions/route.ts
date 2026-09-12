import { requireAdmin } from '@/lib/admin';
import { adminError, adminJson } from '@/lib/admin-question-http';
import { QuestionAdminError } from '@/lib/admin-questions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const admin = await requireAdmin(request);
    if (!admin) return adminJson({ error: '僅限管理員使用' }, 403);
    const { sql } = admin;
    const p = new URL(request.url).searchParams;
    const integer = (name: string) => {
      const value = p.get(name);
      if (!value) return null;
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647) throw new QuestionAdminError('搜尋條件數字無效');
      return Number(value);
    };
    const setId = integer('question_set_id'), id = integer('id'), number = integer('number'), year = integer('year');
    const page = integer('page') ?? 1;
    const quality = p.get('quality') ?? 'all';
    if (!['all', 'missing_answer', 'has_answer', 'missing_explanation', 'has_explanation', 'invalid'].includes(quality)) throw new QuestionAdminError('無效篩選');
    const keyword = (p.get('keyword') ?? '').trim(), subject = (p.get('subject') ?? '').trim();
    if (keyword.length > 200 || subject.length > 100) throw new QuestionAdminError('搜尋文字過長');
    const values = [setId, id, number, year, subject, keyword, quality];
    const where = `($1::int IS NULL OR q.question_set_id=$1) AND ($2::int IS NULL OR q.id=$2)
      AND ($3::int IS NULL OR q.question_number=$3) AND ($4::int IS NULL OR qs.exam_year=$4)
      AND ($5::text='' OR q.subject=$5) AND ($6::text='' OR STRPOS(LOWER(q.question),LOWER($6))>0)
      AND ($7::text='all'
        OR ($7='missing_answer' AND NULLIF(BTRIM(q.answer),'') IS NULL)
        OR ($7='has_answer' AND NULLIF(BTRIM(q.answer),'') IS NOT NULL)
        OR ($7='missing_explanation' AND NULLIF(BTRIM(q.explanation),'') IS NULL)
        OR ($7='has_explanation' AND NULLIF(BTRIM(q.explanation),'') IS NOT NULL)
        OR ($7='invalid' AND NULLIF(BTRIM(q.answer),'') IS NOT NULL AND UPPER(BTRIM(q.answer)) !~ '^[A-D]$'))`;
    // Every query is behind the existing session-based admin guard.
    const [summary, sets, count, questions] = await Promise.all([
      sql.query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE answer IS NULL)::int AS answer_null,
        COUNT(*) FILTER (WHERE answer IS NOT NULL AND BTRIM(answer)='')::int AS answer_blank,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(answer),'') IS NULL)::int AS missing_answer,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(explanation),'') IS NULL)::int AS missing_explanation,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(answer),'') IS NULL AND NULLIF(BTRIM(explanation),'') IS NULL)::int AS missing_both,
        COUNT(*) FILTER (WHERE NULLIF(BTRIM(answer),'') IS NOT NULL AND UPPER(BTRIM(answer)) !~ '^[A-D]$')::int AS invalid FROM questions`, []),
      sql.query(`SELECT qs.id,qs.name,qs.exam_year,qs.exam_subject,qs.visibility,COUNT(q.id)::int AS total,
        COUNT(q.id) FILTER (WHERE NULLIF(BTRIM(q.answer),'') IS NULL)::int AS missing_answer,
        COUNT(q.id) FILTER (WHERE NULLIF(BTRIM(q.explanation),'') IS NULL)::int AS missing_explanation
        FROM question_sets qs LEFT JOIN questions q ON q.question_set_id=qs.id
        GROUP BY qs.id ORDER BY qs.exam_year DESC NULLS LAST,qs.id DESC`, []),
      sql.query(`SELECT COUNT(*)::int AS total FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id WHERE ${where}`, values),
      sql.query(`SELECT q.id,q.question_set_id,q.question_number,q.subject,q.question,q.option_a,q.option_b,q.option_c,q.option_d,q.option_e,q.answer,q.explanation,qs.exam_year,qs.name AS question_set_name
        FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id WHERE ${where}
        ORDER BY q.question_set_id,q.question_number,q.id LIMIT 100 OFFSET $8`, [...values, (page - 1) * 100]),
    ]);
    // The keyboard editor requests the complete, bounded set separately from search pagination.
    const editor = p.get('editor') === '1';
    if (editor && !setId) throw new QuestionAdminError('請先選擇題庫');
    if (editor) {
      const set = sets.find(s => s.id === setId);
      if (!set) throw new QuestionAdminError('找不到題庫', 404);
      if (Number(set.total) > 1000) throw new QuestionAdminError('此題庫超過 1000 題，請使用單題搜尋編輯');
      const rows = await sql.query('SELECT id,question_set_id,question_number,subject,question,option_a,option_b,option_c,option_d,option_e,answer,explanation FROM questions WHERE question_set_id=$1 ORDER BY question_number,id', [setId]);
      return adminJson({ questions: rows });
    }
    return adminJson({ summary: summary[0], sets, total: count[0].total, questions, page });
  } catch (error) { return adminError(error); }
}
