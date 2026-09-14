import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { questionTransaction } from '@/lib/question-transaction';
import { NOTE_BODY_MAX_BYTES, parseNote, parseNoteFilters, validNoteId } from '@/lib/notes';
import { deleteNote, listNotes, NoteError, reactToNote, readNote, saveNote } from '@/lib/notes-service';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function notesHttp(request: Request, id?: string) {
  try {
    const write = request.method !== 'GET', origin = request.headers.get('origin');
    if (write && ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site')) return json({ error: '不允許此來源' }, 403);
    const session = await auth.api.getSession({ headers: request.headers });
    const actor = { id: session?.user?.id ?? null, admin: !!session?.user?.id && session.user.id === process.env.ADMIN_USER_ID?.trim() };
    if (write && !actor.id) return json({ error: '請先登入後使用筆記。' }, 401);
    if (id !== undefined && !validNoteId(id)) return json({ error: '找不到筆記。' }, 404);
    if (request.method === 'GET') {
      if (id) return json(await questionTransaction(client => readNote(client, actor, id)));
      const filters = parseNoteFilters(new URL(request.url).searchParams);
      if (!filters) return json({ error: '筆記篩選條件無效。' }, 400);
      return json(await questionTransaction(client => listNotes(client, actor, filters)));
    }
    if (request.method === 'DELETE' && id) return json(await questionTransaction(client => deleteNote(client, actor, id)));
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: '請使用 JSON 文字資料。' }, 415);
    const reader = request.body?.getReader(); if (!reader) return json({ error: '缺少筆記資料。' }, 400);
    let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > NOTE_BODY_MAX_BYTES) { await reader.cancel(); return json({ error: '筆記資料過大。' }, 413); } chunks.push(value); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json({ error: '資料格式錯誤。' }, 400); }
    if (request.method === 'POST' && !id || request.method === 'PUT' && id) {
      const input = parseNote(body); if (!input) return json({ error: '請確認文字長度、正式科目章節及公開狀態。' }, 400);
      return json(await questionTransaction(client => saveNote(client, actor, input, id)));
    }
    if (request.method === 'PATCH' && id && body && typeof body === 'object' && !Array.isArray(body)) {
      const row = body as Record<string, unknown>;
      if (Object.keys(row).sort().join() === 'active,kind' && (row.kind === 'helpful' || row.kind === 'favorite') && typeof row.active === 'boolean') {
        const kind = row.kind, active = row.active;
        return json(await questionTransaction(client => reactToNote(client, actor, id, kind, active)));
      }
    }
    return json({ error: '筆記操作無效。' }, 400);
  } catch (error) {
    if (error instanceof NoteError) return json({ error: error.message }, error.status);
    return json({ error: '筆記暫時無法連線，請稍後重新載入。' }, 503);
  }
}
