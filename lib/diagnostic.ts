import { EXAM_SUBJECTS, validChapter } from "../data/exam-chapters";

export const DIAGNOSTIC_CONFIG = {
  questionsPerSubject: 10,
  recentDays: 7,
  minSubjectAnswers: 5,
  suspectBelow: 0.6,
  maxSuspectSubjects: 2,
} as const;

export type Candidate = { id: number; subject: string; chapter: string | null; last_answered: string | null };
export type DiagnosticKind = "initial" | "confirmation" | "verification";
export type DiagnosticSummary = { subject: string; total: number; answered: number; correct: number; insufficient: boolean; suspect: boolean };
export type DiagnosticView = {
  mode: string | null;
  session: null | {
    id: string; total: number; answered: number; completed: boolean;
    shortages: { subject: string; available: number }[];
    results: DiagnosticSummary[];
    current: null | { position: number; questionId: number; subject: string; chapter: string | null; question: string; options: string[]; image: string | null };
  };
};

// Unseen first, then older history, then recent history. Within each tier,
// pick the least represented chapter; ties prefer the oldest answered item.
export function selectDiagnosticQuestions(candidates: Candidate[], now = Date.now(), random = Math.random): Candidate[] {
  const cutoff = now - DIAGNOSTIC_CONFIG.recentDays * 86400000;
  const unique = [...new Map(candidates.map(row => [row.id, row])).values()];
  const rank = (row: Candidate) => !row.last_answered ? 0 : Date.parse(row.last_answered) < cutoff ? 1 : 2;
  const time = (row: Candidate) => row.last_answered ? Date.parse(row.last_answered) : 0;
  const groups = EXAM_SUBJECTS.map(subject => {
    const pool = unique.filter(row => row.subject === subject).map(row => ({ ...row, chapter: validChapter(subject, row.chapter) ? row.chapter || null : null, tie: random() }));
    const counts = new Map<string | null, number>();
    const picked: Candidate[] = [];
    while (pool.length && picked.length < DIAGNOSTIC_CONFIG.questionsPerSubject) {
      pool.sort((a, b) => rank(a) - rank(b) || (counts.get(a.chapter) ?? 0) - (counts.get(b.chapter) ?? 0) || time(a) - time(b) || a.tie - b.tie || a.id - b.id);
      const row = pool.shift()!;
      counts.set(row.chapter, (counts.get(row.chapter) ?? 0) + 1);
      picked.push({ id: row.id, subject: row.subject, chapter: row.chapter, last_answered: row.last_answered });
    }
    return picked;
  });
  // Interleave subjects instead of putting ten consecutive questions together.
  return Array.from({ length: DIAGNOSTIC_CONFIG.questionsPerSubject }, (_, index) => groups.flatMap(group => group[index] ? [group[index]] : [])).flat();
}

export function summarizeDiagnostic(rows: { subject: string; selected_answer: string | null; is_correct: boolean | null }[]): DiagnosticSummary[] {
  const summary = EXAM_SUBJECTS.map(subject => {
    const items = rows.filter(row => row.subject === subject);
    const answered = items.filter(row => row.selected_answer !== null).length;
    return { subject, total: items.length, answered, correct: items.filter(row => row.is_correct === true).length, insufficient: answered < DIAGNOSTIC_CONFIG.minSubjectAnswers, suspect: false };
  });
  if (rows.length && rows.every(row => row.selected_answer !== null)) {
    const suspects = summary.filter(row => !row.insufficient && row.correct / row.answered < DIAGNOSTIC_CONFIG.suspectBelow)
      .sort((a, b) => a.correct / a.answered - b.correct / b.answered).slice(0, DIAGNOSTIC_CONFIG.maxSuspectSubjects);
    for (const row of suspects) row.suspect = true;
  }
  return summary;
}

export function parseDiagnosticAnswer(body: unknown): { sessionId: string; position: number; answer: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || Object.keys(row).some(key => !["sessionId", "position", "answer"].includes(key))) return null;
  if (typeof row.sessionId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.sessionId) ||
    !Number.isInteger(row.position) || Number(row.position) < 1 || Number(row.position) > EXAM_SUBJECTS.length * DIAGNOSTIC_CONFIG.questionsPerSubject ||
    typeof row.answer !== "string" || !/^[A-E]$/.test(row.answer)) return null;
  return { sessionId: row.sessionId, position: Number(row.position), answer: row.answer };
}
