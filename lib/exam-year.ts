/** Display only: keep the original database value in filters and API requests. */
export function formatExamYear(year: number | null) {
  if (year === null) return "年份未提供";
  const roc = year >= 1912 ? year - 1911 : year;
  const western = year >= 1912 ? year : year + 1911;
  return `民國 ${roc} 年（西元 ${western}）`;
}
