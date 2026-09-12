export const IMPORT_BATCH_LIMIT = 4_000_000;
export type ImportRange = { from: number; to: number };
export type ImportQuestion = { question: string; options: string[]; answer: string; explanation: string; imageDataUrl?: string | null };
export type ImportMetadata = { filename: string; fileHash: string; visibility: "public" | "private"; examSubject: string; examYear: number };
export type ImportBatch = ImportMetadata & { importId: string; ranges: ImportRange[]; totalQuestions: number; batchIndex: number; questions: ImportQuestion[] };

export function validateImportRanges(ranges: ImportRange[], total: number) {
  if (!Number.isInteger(total) || total < 1 || total > 2000 || !ranges.length || ranges.length > 200) throw new Error("請設定有效批次（最多 200 批、2000 題）。");
  let next = 1;
  for (const range of ranges) {
    if (!range || !Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from !== next || range.to < range.from || range.to > total) {
      throw new Error(`批次必須依序且不重疊，下一批應從第 ${next} 題開始。`);
    }
    next = range.to + 1;
  }
  if (next !== total + 1) throw new Error(`請涵蓋全部 ${total} 題，目前只設定到第 ${next - 1} 題。`);
}

export function buildImportBatches(metadata: ImportMetadata, questions: ImportQuestion[], ranges: ImportRange[], importId: string) {
  validateImportRanges(ranges, questions.length);
  return ranges.map((range, batchIndex) => {
    const batch: ImportBatch = { ...metadata, importId, ranges, totalQuestions: questions.length, batchIndex,
      questions: questions.slice(range.from - 1, range.to).map((question) => ({
        question: question.question, options: [...question.options], answer: question.answer,
        explanation: question.explanation, imageDataUrl: question.imageDataUrl || null,
      })),
    };
    const body = JSON.stringify(batch);
    const bytes = new TextEncoder().encode(body).byteLength;
    if (bytes > IMPORT_BATCH_LIMIT) throw new Error(`第 ${batchIndex + 1} 批（${range.from}–${range.to} 題）約 ${(bytes / 1_000_000).toFixed(2)} MB，超過 4 MB，請縮小範圍；若只有一題，請縮小該題圖片。`);
    return { body, bytes };
  });
}

export async function readImportResponse(response: Response): Promise<{ questionSetId?: number; complete?: boolean; message?: string }> {
  const text = await response.text();
  if (response.status === 413) throw new Error("儲存資料超過伺服器容量限制（HTTP 413），請啟用分批匯入或縮小每批範圍／圖片。");
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`伺服器未回傳 JSON（HTTP ${response.status}），題目仍保留，請稍後重試。`); }
  if (!response.ok) throw new Error(data?.detail || data?.error || `匯入失敗（HTTP ${response.status}）`);
  if (!data || typeof data !== "object") throw new Error("匯入回應格式錯誤，請稍後重試。");
  return data;
}
