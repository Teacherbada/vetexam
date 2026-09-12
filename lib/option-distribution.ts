export type OptionCount = { letter: string; count: number; percentage: number };
export type OptionDistributionData = {
  total: number; sufficient: boolean; min_attempts: number; options: OptionCount[];
};

// The answer key comes from the existing quiz result, never the public stats API.
export function mostMistaken(options: OptionCount[], correctAnswer: string) {
  const correct = correctAnswer.trim().toUpperCase();
  if (!options.some((option) => option.letter === correct)) return [];
  const wrong = options.filter((option) => option.letter !== correct && option.count > 0);
  const highest = Math.max(0, ...wrong.map((option) => option.count));
  return wrong.filter((option) => option.count === highest);
}
