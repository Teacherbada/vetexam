type Answer = { question_id: number; selected_answer: string };
const pending = new Map<number, Promise<void>>();

export function waitForAnswerStatistics(questionId: number) {
  return pending.get(questionId) ?? Promise.resolve();
}

// Preserve the existing bounded retry policy; results and navigation never wait.
export function sendStatistics(answers: Answer[]) {
  const sending = (async () => {
    for (let index = 0; index < answers.length; index += 100) {
      const body = JSON.stringify({ answers: answers.slice(index, index + 100) });
      for (let retry = 0; retry < 2; retry++) {
        try {
          const response = await fetch("/api/stats/answers", {
            method: "POST", headers: { "Content-Type": "application/json" }, body,
            keepalive: true, signal: AbortSignal.timeout(8000),
          });
          if (response.ok || response.status < 500) break;
        } catch { /* Preserve local results when statistics are unavailable. */ }
        if (retry === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  })();
  for (const answer of answers) pending.set(answer.question_id, sending);
  void sending.finally(() => {
    for (const answer of answers) if (pending.get(answer.question_id) === sending) pending.delete(answer.question_id);
  });
  return sending;
}
