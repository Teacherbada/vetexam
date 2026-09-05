// Presentation-only statistics over the existing progress storage format.
// Keep these identities aligned with the existing national-exam subject list.
export const subjectPalette: Record<string, { main: string; light: string }> = {
  獸醫病理學: { main: "#B97872", light: "#F7EBE9" },
  獸醫藥理學: { main: "#C58B72", light: "#F8EEE9" },
  獸醫實驗診斷學: { main: "#6F91A8", light: "#EDF3F6" },
  獸醫普通疾病學: { main: "#6F9C8B", light: "#EAF3EF" },
  獸醫傳染病學: { main: "#9A7E9F", light: "#F2EDF3" },
  獸醫公共衛生學: { main: "#B29A61", light: "#F6F1E5" },
};
const fallbackColor = { main: "#7C8FA8", light: "#EEF1F5" };
export const MIN_SAMPLE_SIZE = 10;
export type SubjectPerformance = {
  subject: string;
  answered: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
  color: { main: string; light: string };
};

export function getMasteryStatus(accuracy: number | null, answered: number) {
  if (answered < MIN_SAMPLE_SIZE || accuracy === null) return "資料不足";
  if (accuracy >= 80) return "掌握良好";
  if (accuracy >= 65) return "穩定";
  if (accuracy >= 50) return "需要加強";
  return "優先複習";
}

export function buildAnalysis(raw: string) {
  let source: Record<string, unknown> = {};
  let hasInvalidRecords = false;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid progress");
    source = parsed as Record<string, unknown>;
  } catch {
    hasInvalidRecords = true;
  }
  const records = new Map<string, { answered: number; correct: number; wrong: number }>();
  for (const [subject, value] of Object.entries(source)) {
    if (!subject.trim() || !value || typeof value !== "object") { hasInvalidRecords = true; continue; }
    const item = value as Record<string, unknown>;
    if (!Array.isArray(item.answered) || !item.answered.every((id) => Number.isSafeInteger(id)) ||
      new Set(item.answered).size !== item.answered.length ||
      typeof item.correct !== "number" || !Number.isSafeInteger(item.correct) || item.correct < 0 ||
      typeof item.wrong !== "number" || !Number.isSafeInteger(item.wrong) || item.wrong < 0 ||
      item.correct + item.wrong !== item.answered.length) {
      hasInvalidRecords = true;
      continue;
    }
    records.set(subject, { answered: item.answered.length, correct: item.correct, wrong: item.wrong });
  }
  const names = [...new Set([...Object.keys(subjectPalette), ...records.keys()])];
  const subjects: SubjectPerformance[] = names.map((subject) => {
    const record = records.get(subject) ?? { answered: 0, correct: 0, wrong: 0 };
    return { subject, ...record, accuracy: record.answered ? record.correct / record.answered * 100 : null,
      color: Object.hasOwn(subjectPalette, subject) ? subjectPalette[subject] : fallbackColor };
  });
  const answered = subjects.reduce((sum, record) => sum + record.answered, 0);
  const correct = subjects.reduce((sum, record) => sum + record.correct, 0);
  const wrong = subjects.reduce((sum, record) => sum + record.wrong, 0);
  // Compare unrounded scores; a small sample cannot establish a weakest subject.
  const ranking = subjects.filter((record) => record.answered >= MIN_SAMPLE_SIZE)
    .sort((a, b) => a.accuracy! - b.accuracy! || b.answered - a.answered || a.subject.localeCompare(b.subject, "zh-Hant"));
  return { subjects, ranking, answered, correct, wrong, accuracy: answered ? correct / answered * 100 : null, hasInvalidRecords };
}

export function practiceHref(subject: string) {
  // Unknown historical subject names remain visible, without inventing a new bank.
  if (!Object.hasOwn(subjectPalette, subject)) return "/subjects";
  return `/questions?${new URLSearchParams({ subjects: subject, count: "20", order: "random" })}`;
}
