export function usableAnswer(question: { answer: string | null; options: string[] }): string | null {
  const answer = (question.answer ?? '').trim().toUpperCase();
  return /^[A-E]$/.test(answer) && Boolean(question.options[answer.charCodeAt(0) - 65]?.trim()) ? answer : null;
}
