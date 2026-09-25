import { auth } from '@/lib/auth';
import { questionTransaction } from '@/lib/question-transaction';
import { readLearning, recordPractice } from '@/lib/learning-service';
import { parseAnswerSubmissions } from '@/lib/question-stats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user.id) return response({ owner: null });
    return response(await questionTransaction(client => readLearning(client, session.user.id)));
  } catch { return response({ error: '帳號紀錄暫時無法讀取，請稍後重試。' }, 503); }
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: '不允許此來源' }, 403);
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user.id) return response({ error: '請先登入' }, 401);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return response({ error: '請使用 JSON' }, 415);
    const reader = request.body?.getReader();
    if (!reader) return response({ error: '缺少資料' }, 400);
    let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 2_000_000) { await reader.cancel(); return response({ error: '資料過大，原始紀錄仍保留在本機' }, 413); } chunks.push(value); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || body.owner !== session.user.id) return response({ error: '帳號已變更，請重新載入' }, 409);
    if (body.action === 'answers') {
      if (!Array.isArray(body.answers) || !body.answers.every((a: Record<string, unknown>) => a && typeof a.event_id === 'string' && uuid.test(a.event_id))) return response({ error: '作答格式錯誤' }, 400);
      const valid = parseAnswerSubmissions({ answers: body.answers.map((a: Record<string, unknown>) => ({ question_id: a.question_id, selected_answer: a.selected_answer })) });
      if (!valid || !['practice','exam'].includes(body.mode)) return response({ error: '作答格式錯誤' }, 400);
      if (body.answers.some((a: { answered_at?: unknown }) => a.answered_at !== undefined && (typeof a.answered_at !== 'string' || !Number.isFinite(Date.parse(a.answered_at)) || Date.parse(a.answered_at) > Date.now() + 300000 || Date.parse(a.answered_at) < Date.UTC(2000,0,1)))) return response({ error: '作答時間格式錯誤' }, 400);
      await questionTransaction(client => recordPractice(client, session.user.id, body.answers.map((a: { selected_answer: string }) => ({ ...a, selected_answer: a.selected_answer.toUpperCase() })), body.mode));
    } else if (body.action === 'review') {
      if (!Number.isInteger(body.questionId) || body.questionId < 1 || !['favorite','wrong','note'].includes(body.field) ||
        (body.field === 'note' ? typeof body.value !== 'string' || body.value.length > 10000 : typeof body.value !== 'boolean')) return response({ error: '複習資料格式錯誤' }, 400);
      await questionTransaction(async client => {
        // Column names are selected exclusively from the above fixed allowlist.
        await client.query(`INSERT INTO question_review_state(user_id,question_id,${body.field})
          SELECT $1,q.id,$3 FROM questions q JOIN question_sets qs ON qs.id=q.question_set_id WHERE q.id=$2 AND qs.visibility='public'
          ON CONFLICT(user_id,question_id) DO UPDATE SET ${body.field}=EXCLUDED.${body.field}`, [session.user.id, body.questionId, body.value]);
      });
    } else if (body.action === 'import') {
      if (typeof body.deviceId !== 'string' || !uuid.test(body.deviceId) || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return response({ error: '遷移格式錯誤' }, 400);
      await questionTransaction(async client => {
        const saved = await client.query(`INSERT INTO learning_imports(user_id,device_id,payload) VALUES($1,$2,$3::jsonb)
          ON CONFLICT(user_id,device_id) DO NOTHING RETURNING device_id`, [session.user.id, body.deviceId, JSON.stringify(body.payload)]);
        if (!saved.rows.length) return;
        const merged = new Map<number, { id: number; favorite: boolean; wrong: boolean | null; note: string }>();
        for (const [key, field] of [['favorites','favorite'],['wrongQuestions','wrong']] as const) {
          const rows = body.payload[key];
          if (!Array.isArray(rows)) continue;
          for (const row of rows) {
            if (!row || !Number.isInteger(row.id) || row.id < 1 || row.id > 2147483647) continue;
            const item = merged.get(row.id) ?? { id: row.id, favorite: false, wrong: null, note: '' };
            item[field] = true;
            if (typeof row.note === 'string') item.note = row.note.slice(0,10000);
            merged.set(row.id, item);
          }
        }
        await client.query(`INSERT INTO question_review_state(user_id,question_id,favorite,wrong,note)
          SELECT $1,q.id,a.favorite,a.wrong,a.note FROM jsonb_to_recordset($2::jsonb) a(id integer,favorite boolean,wrong boolean,note text)
          JOIN questions q ON q.id=a.id JOIN question_sets qs ON qs.id=q.question_set_id WHERE qs.visibility='public'
          ON CONFLICT(user_id,question_id) DO NOTHING`, [session.user.id, JSON.stringify([...merged.values()])]);
      });
    } else return response({ error: '未知操作' }, 400);
    return response({ success: true });
  } catch { return response({ error: '紀錄暫時無法儲存，原始本機資料已保留。' }, 503); }
}
