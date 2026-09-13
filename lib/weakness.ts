import { EXAM_SUBJECTS, chapterGroups, validChapter } from "../data/exam-chapters";
import { type Candidate, type DiagnosticView } from "./diagnostic";

export const WEAKNESS_CONFIG = {
  lookbackDays: 30,
  recentSample: 10,
  minSubjectQuestions: 10,
  minChapterQuestions: 5,
  minConfirmationQuestions: 3,
  minRepeatedErrors: 2,
  goodAt: 0.8,
  strengthenBelow: 0.6,
  maxPriorities: 2,
  maxTargetSubjects: 2,
  questionsPerSubject: 20,
  questionsPerChapter: 5,
  avoidRepeatDays: 7,
} as const;

export type Evidence = {
  question_id: number; subject: string; chapter: string | null;
  is_correct: boolean; answered_at: string; kind: "initial" | "confirmation" | "first";
};
export type WeaknessStatus = "insufficient" | "good" | "review" | "strengthen";
export const WEAKNESS_LABELS: Record<WeaknessStatus, string> = {
  insufficient: "資料不足", good: "掌握良好", review: "需要複習", strengthen: "優先加強",
};
export type Performance = {
  subject: string; chapter: string | null; count: number; correct: number; accuracy: number | null;
  recentCount: number; recentCorrect: number; recentAccuracy: number | null;
  confirmationCount: number; distinctErrors: number; status: WeaknessStatus;
};
export type WeaknessAnalysis = {
  subjects: (Performance & { unclassified: number; chapters: Performance[] })[];
  priorities: Performance[];
  lookbackDays: number;
};
export type ConfirmationView = DiagnosticView & {
  initialCompleted: boolean;
  targets: string[];
  available: { subject: string; count: number }[];
  analysis: WeaknessAnalysis;
};

// Deduplicate globally by source question; recent repeats cannot inflate sample size.
export function recentEvidence(rows: Evidence[], now = Date.now()): Evidence[] {
  const cutoff = now - WEAKNESS_CONFIG.lookbackDays * 86400000;
  const ordered = rows.filter(row => EXAM_SUBJECTS.includes(row.subject) && typeof row.is_correct === "boolean" &&
    Date.parse(row.answered_at) >= cutoff && Date.parse(row.answered_at) <= now)
    .sort((a, b) => Date.parse(b.answered_at) - Date.parse(a.answered_at) ||
      ({ confirmation: 0, initial: 1, first: 2 }[a.kind] - { confirmation: 0, initial: 1, first: 2 }[b.kind]));
  const unique = new Map<number, Evidence>();
  for (const row of ordered) if (!unique.has(row.question_id)) unique.set(row.question_id, {
    ...row, chapter: row.chapter && validChapter(row.subject, row.chapter) ? row.chapter : null,
  });
  return [...unique.values()];
}

export function buildWeaknessAnalysis(rows: Evidence[], now = Date.now()): WeaknessAnalysis {
  const evidence = recentEvidence(rows, now);
  function assess(subject: string, chapter: string | null, items: Evidence[]): Performance {
    const count = items.length;
    const correct = items.filter(row => row.is_correct).length;
    const recent = items.slice(0, WEAKNESS_CONFIG.recentSample);
    const recentCorrect = recent.filter(row => row.is_correct).length;
    const confirmationCount = items.filter(row => row.kind === "confirmation").length;
    const distinctErrors = recent.length - recentCorrect;
    const accuracy = count ? correct / count : null;
    const recentAccuracy = recent.length ? recentCorrect / recent.length : null;
    const minimum = chapter === null ? WEAKNESS_CONFIG.minSubjectQuestions : WEAKNESS_CONFIG.minChapterQuestions;
    let status: WeaknessStatus = "insufficient";
    if (count >= minimum && (chapter === null || confirmationCount >= WEAKNESS_CONFIG.minConfirmationQuestions)) {
      const score = Math.min(accuracy!, recentAccuracy!);
      status = score >= WEAKNESS_CONFIG.goodAt ? "good"
        : score < WEAKNESS_CONFIG.strengthenBelow && distinctErrors >= WEAKNESS_CONFIG.minRepeatedErrors ? "strengthen" : "review";
    }
    return { subject, chapter, count, correct, accuracy, recentCount: recent.length, recentCorrect, recentAccuracy, confirmationCount, distinctErrors, status };
  }
  const subjects = EXAM_SUBJECTS.map(subject => {
    const items = evidence.filter(row => row.subject === subject);
    return { ...assess(subject, null, items), unclassified: items.filter(row => !row.chapter).length,
      chapters: chapterGroups(subject).flatMap(group => group.chapters).map(chapter => assess(subject, chapter, items.filter(row => row.chapter === chapter))),
    };
  });
  const priorities = subjects.flatMap(row => row.chapters).filter(row => row.status === "strengthen" || row.status === "review")
    .sort((a, b) => (a.status === "strengthen" ? 0 : 1) - (b.status === "strengthen" ? 0 : 1) ||
      a.recentAccuracy! - b.recentAccuracy! || b.distinctErrors - a.distinctErrors || b.count - a.count)
    .slice(0, WEAKNESS_CONFIG.maxPriorities);
  return { subjects, priorities, lookbackDays: WEAKNESS_CONFIG.lookbackDays };
}

export function confirmationTargets(initial: NonNullable<DiagnosticView["session"]>): string[] {
  if (!initial.completed) return [];
  return initial.results.filter(row => !row.insufficient && row.answered > 0 && row.correct / row.answered < WEAKNESS_CONFIG.goodAt)
    .sort((a, b) => a.correct / a.answered - b.correct / b.answered)
    .slice(0, WEAKNESS_CONFIG.maxTargetSubjects).map(row => row.subject);
}

export function selectConfirmationQuestions(candidates: Candidate[], targets: string[], analysis: WeaknessAnalysis, now = Date.now(), random = Math.random): Candidate[] {
  const cutoff = now - WEAKNESS_CONFIG.avoidRepeatDays * 86400000;
  const candidatesById = new Map(candidates.map(row => [row.id, row]));
  const eligible = [...candidatesById.values()].filter(row => targets.includes(row.subject) &&
    (!row.last_answered || Date.parse(row.last_answered) < cutoff))
    .map(row => ({ ...row, chapter: row.chapter && validChapter(row.subject, row.chapter) ? row.chapter : null, tie: random() }));
  const batches = targets.map(subject => {
    const pool = eligible.filter(row => row.subject === subject);
    const metrics = analysis.subjects.find(row => row.subject === subject);
    const chapterNames = [...new Set(pool.flatMap(row => row.chapter ? [row.chapter] : []))];
    chapterNames.sort((a, b) => {
      const ca = metrics?.chapters.find(row => row.chapter === a), cb = metrics?.chapters.find(row => row.chapter === b);
      return Number(cb?.status === "insufficient") - Number(ca?.status === "insufficient") || (ca?.count ?? 0) - (cb?.count ?? 0);
    });
    const rank = (a: typeof pool[number], b: typeof pool[number]) => Number(Boolean(a.last_answered)) - Number(Boolean(b.last_answered)) ||
      (a.last_answered ? Date.parse(a.last_answered) : 0) - (b.last_answered ? Date.parse(b.last_answered) : 0) || a.tie - b.tie || a.id - b.id;
    const picked: Candidate[] = [];
    // Unseen questions precede older fallback questions, including when their
    // chapter is unknown. Within a tier, gather chapter confirmation samples.
    for (const seen of [false, true]) {
      const tier = pool.filter(row => Boolean(row.last_answered) === seen);
      for (const chapter of chapterNames) {
        const ids = new Set(picked.map(row => row.id));
        const group = tier.filter(row => row.chapter === chapter && !ids.has(row.id)).sort(rank);
        const remaining = Math.max(0, WEAKNESS_CONFIG.questionsPerChapter - picked.filter(row => row.chapter === chapter).length);
        picked.push(...group.slice(0, Math.min(remaining, WEAKNESS_CONFIG.questionsPerSubject - picked.length)));
        if (picked.length >= WEAKNESS_CONFIG.questionsPerSubject) break;
      }
      const ids = new Set(picked.map(row => row.id));
      picked.push(...tier.filter(row => !ids.has(row.id)).sort(rank).slice(0, WEAKNESS_CONFIG.questionsPerSubject - picked.length));
    }
    return picked;
  });
  return Array.from({ length: WEAKNESS_CONFIG.questionsPerSubject }, (_, index) => batches.flatMap(batch => batch[index] ? [batch[index]] : [])).flat();
}
