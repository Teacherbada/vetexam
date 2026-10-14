/** Empty members/duplicates are removed; invalid nonempty members reject the whole key. */
export function answerKeys(value: unknown, allowLegacyE = true): string[] {
  if (typeof value === 'string') {
    const text = value.trim().toUpperCase();
    if (!text) return [];
    if (text.startsWith('[')) { try { value = JSON.parse(text); } catch { return []; } }
    else value = text.split(/[,、，/\s]+/);
  }
  if (!Array.isArray(value)) return [];
  const entries = value.filter(item => item !== null && item !== undefined && item !== '').map(item => typeof item === 'string' ? item.trim().toUpperCase() : item).filter(item => item !== '');
  const valid = allowLegacyE ? /^[A-E]$/ : /^[A-D]$/;
  if (!entries.length || entries.some(item => typeof item !== 'string' || !valid.test(item))) return [];
  const keys = [...new Set(entries as string[])].sort();
  return keys.includes('E') && keys.length > 1 ? [] : keys;
}
export function serializeAnswer(value: unknown, allowLegacyE = false): string | null {
  const keys = answerKeys(value, allowLegacyE);
  return keys.length === 1 ? keys[0] : keys.length ? JSON.stringify(keys) : null;
}
export function formatAnswer(value: unknown): string { return answerKeys(value).join('、'); }
export const OFFICIAL_ANSWER_CHOICES = Array.from({ length: 15 }, (_, index) => 'ABCD'.split('').filter((_, bit) => (index + 1) & (1 << bit)))
  .sort((a, b) => a.length - b.length || a.join('').localeCompare(b.join(''))).map(keys => ({ value: serializeAnswer(keys)!, label: keys.join('、') }));
export function isCorrectAnswer(value: unknown, selected: string): boolean {
  return /^[A-E]$/i.test(selected) && answerKeys(value).includes(selected.toUpperCase());
}
export function usableAnswer(question: { answer: unknown; options: string[] }): string | null {
  const keys = answerKeys(question.answer);
  return keys.length && keys.every(answer => {
    const option = question.options[answer.charCodeAt(0) - 65];
    return typeof option === 'string' && Boolean(option.trim());
  }) ? serializeAnswer(keys, true) : null;
}
export function importedAnswer(value: unknown, options: string[], allowLegacyE = false): string | null {
  if (value == null || typeof value === 'string' && !value.trim()) return '';
  const answer = serializeAnswer(value, allowLegacyE);
  return answer && usableAnswer({ answer, options });
}
