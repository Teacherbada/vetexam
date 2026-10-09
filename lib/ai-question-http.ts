import 'server-only';
import { QuestionAdminError } from './admin-questions';
export { adminJson as aiJson, adminError as aiError } from './admin-question-http';
export async function readAIBody(request: Request): Promise<Record<string, unknown>> {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new QuestionAdminError('不允許此來源', 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new QuestionAdminError('請使用 JSON 格式', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new QuestionAdminError('缺少資料');
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new QuestionAdminError('每批 JSON 最多 2 MB', 413); } chunks.push(value); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new QuestionAdminError('JSON 格式錯誤'); }
}
