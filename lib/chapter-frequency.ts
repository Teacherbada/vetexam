import { EXAM_CHAPTERS } from '../data/exam-chapters';
export type FrequencyInput = { subject: string; chapter: string | null; year: number | null; paper: number; count: number };
export type FrequencyRow = { subject: string; chapter: string; count: number; papers: number; average: number | null; share: number };
export function chapterFrequency(input: FrequencyInput[], years: 5 | 10 | null) {
  const western = (year: number) => year >= 1912 ? year : year + 1911;
  const known = input.flatMap(row => row.year === null ? [] : [western(row.year)]);
  const latestYear = known.length ? Math.max(...known) : null;
  const rows = input.filter(row => years === null || row.year !== null && latestYear !== null && western(row.year) >= latestYear - years + 1 && western(row.year) <= latestYear);
  const output: FrequencyRow[] = [];
  for (const [subject, groups] of Object.entries(EXAM_CHAPTERS)) {
    const items = rows.filter(row => row.subject === subject);
    const papers = new Set(items.map(row => row.paper)).size;
    const total = items.reduce((sum, row) => sum + row.count, 0);
    for (const chapter of groups.flatMap(group => [...group.chapters])) {
      const count = items.filter(row => row.chapter === chapter).reduce((sum, row) => sum + row.count, 0);
      output.push({ subject, chapter, count, papers, average: papers ? count / papers : null, share: total ? count / total : 0 });
    }
  }
  return { latestYear, rows: output, unclassified: rows.filter(row => !row.chapter || !EXAM_CHAPTERS[row.subject]?.some(group => group.chapters.includes(row.chapter!))).reduce((sum,row) => sum + row.count,0) };
}
