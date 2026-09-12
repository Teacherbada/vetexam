import 'server-only';
import { NextResponse } from 'next/server';
import { QuestionAdminError } from './admin-questions';

export const adminJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export function adminError(error: unknown) {
  if (error instanceof QuestionAdminError) return adminJson({ error: error.message }, error.status);
  console.error('Admin question operation failed');
  return adminJson({ error: '題目維護暫時無法完成，請重新預覽後重試' }, 503);
}
export async function readAdminBody(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new QuestionAdminError('不允許此來源', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new QuestionAdminError('請使用 JSON 格式', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new QuestionAdminError('缺少答案資料');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 65536) { await reader.cancel(); throw new QuestionAdminError('答案資料過大', 413); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new QuestionAdminError('JSON 格式錯誤'); }
}
