import { usableAnswer } from './question-answer';

// Session-only display counts; do not change saved learning records or grading.
export function quizProgress(questions: { id: number; answer: string | null; options: string[] }[], answers: Record<number, string>) {
  const gradable = questions.filter(question => usableAnswer(question));
  return {
    attempted: questions.filter(question => Boolean(answers[question.id])).length,
    scored: gradable.filter(question => Boolean(answers[question.id])).length,
    gradable: gradable.length,
    pending: questions.length - gradable.length,
    unanswered: gradable.filter(question => !answers[question.id]).length,
  };
}
