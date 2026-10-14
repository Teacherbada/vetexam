/** Display only: keep the original database value in filters and API requests. */
export const MIN_EXAM_ROC_YEAR = 90;
export const latestExamRocYear = () => new Date().getFullYear() - 1911;
export const examRocYears = () => Array.from({ length: latestExamRocYear() - MIN_EXAM_ROC_YEAR + 1 }, (_, index) => latestExamRocYear() - index);
/** Existing storage is Gregorian. Accept ROC inputs too, without rewriting old rows. */
export function normalizeExamYear(value: unknown): number | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)) return null;
  const roc = number >= 1912 ? number - 1911 : number;
  return roc >= MIN_EXAM_ROC_YEAR && roc <= latestExamRocYear() ? roc + 1911 : null;
}
export function formatExamYear(year: number | null) {
  if (year === null) return "年份未提供";
  const roc = year >= 1912 ? year - 1911 : year;
  const western = year >= 1912 ? year : year + 1911;
  return `民國 ${roc} 年（西元 ${western}）`;
}
