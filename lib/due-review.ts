import type { QuizQuestion } from '@/components/questions/QuestionCard';

export type DueReview = {
  owner: string;
  asOf: string;
  dueNow: number;
  dueToday: number;
  upcoming7Days: number;
  queue: QuizQuestion[];
};

export function reviewLimit(value: string | null): number | null {
  if (value === null) return 20;
  return ['5', '10', '20', '30', '50'].includes(value) ? Number(value) : null;
}

export function reviewBoundaries(now: Date) {
  const day = 86_400_000;
  const offset = 8 * 3_600_000;
  return {
    todayEnd: new Date(Math.floor((+now + offset) / day) * day + day - offset),
    upcomingEnd: new Date(+now + 7 * day),
  };
}
