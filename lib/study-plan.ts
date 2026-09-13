export const STUDY_MODES = ["coach", "custom"] as const;
export type StudyMode = typeof STUDY_MODES[number];

export function isStudyMode(value: unknown): value is StudyMode {
  return value === "coach" || value === "custom";
}

export function parseStudyMode(body: unknown): StudyMode | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const fields = Object.keys(body);
  if (fields.length !== 1 || fields[0] !== "mode") return null;
  const mode = (body as { mode: unknown }).mode;
  return isStudyMode(mode) ? mode : null;
}
