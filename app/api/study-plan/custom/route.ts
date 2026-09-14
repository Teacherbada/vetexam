import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { questionTransaction } from '@/lib/question-transaction';
import { DiagnosticError } from '@/lib/diagnostic-service';
import { answerCustomDay, previewCustomPlan, readCustomPlan, saveCustomPlan, setCustomPaused, startCustomDay } from '@/lib/custom-plan-service';
import { CUSTOM_TARGET_MAX, parseCustomConfig } from '@/lib/custom-plan';
import { validTaskId } from '@/lib/reinforcement';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function handle(request: Request, method: 'GET' | 'POST' | 'PUT' | 'PATCH') {
  try {
    const origin = request.headers.get('origin');
    if (method !== 'GET' && ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site')) return json({ error: '不允許此來源' }, 403);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user?.id) return json({ error: '請先登入後使用自訂進度。' }, 401);
    const userId = session.user.id;
    if (method === 'GET') return json(await questionTransaction(client => readCustomPlan(client, userId)));
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: '請使用 JSON 格式' }, 415);
    const reader = request.body?.getReader(); if (!reader) return json({ error: '缺少計畫資料' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 16384) { await reader.cancel(); return json({ error: '計畫資料過大' }, 413); } chunks.push(value); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json({ error: '資料格式錯誤' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '資料格式錯誤' }, 400);
    const row = body as Record<string, unknown>;
    if (method === 'PUT') {
      const config = parseCustomConfig(body); if (!config) return json({ error: '請確認每日題數、日期及正式科目章節。' }, 400);
      return json(await questionTransaction(client => saveCustomPlan(client, userId, config)));
    }
    if (method === 'POST') {
      if (row.action === 'preview' && Object.keys(row).length === 2) {
        const config = parseCustomConfig(row.config); if (!config) return json({ error: '請設定題數或完成日期，並至少選擇一科。' }, 400);
        return json(await questionTransaction(client => previewCustomPlan(client, userId, config)));
      }
      if (row.action === 'start' && Object.keys(row).length === 1) return json(await questionTransaction(client => startCustomDay(client, userId)));
    }
    if (method === 'PATCH') {
      if (typeof row.paused === 'boolean' && Object.keys(row).length === 1) {
        const paused = row.paused; return json(await questionTransaction(client => setCustomPaused(client, userId, paused)));
      }
      if (Object.keys(row).sort().join() === 'answer,position,taskId' && validTaskId(row.taskId) && Number.isInteger(row.position) && Number(row.position) >= 1 && Number(row.position) <= CUSTOM_TARGET_MAX && typeof row.answer === 'string' && /^[A-E]$/.test(row.answer)) {
        const submission = { taskId: row.taskId, position: Number(row.position), answer: row.answer };
        return json(await questionTransaction(client => answerCustomDay(client, userId, submission)));
      }
    }
    return json({ error: '計畫操作無效' }, 400);
  } catch (error) {
    if (error instanceof DiagnosticError) return json({ error: error.message }, error.status);
    return json({ error: '自訂進度暫時無法連線，請重新載入確認已儲存進度。' }, 503);
  }
}
export async function GET(request: Request) { return handle(request, 'GET'); }
export async function POST(request: Request) { return handle(request, 'POST'); }
export async function PUT(request: Request) { return handle(request, 'PUT'); }
export async function PATCH(request: Request) { return handle(request, 'PATCH'); }
