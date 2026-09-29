export type ReviewAssessment = { confidence: number; warnings: string[] };
export type ReviewState = 'passed' | 'needs-review' | 'anomaly' | 'reviewed';
export const REVIEW_LABELS: Record<ReviewState, string> = {
  passed: '自動檢查通過',
  'needs-review': '需要確認',
  anomaly: '明顯異常',
  reviewed: '已人工確認',
};

// Presentation of the existing assessment only; no additional parser or scoring.
export function reviewState(assessment: ReviewAssessment, reviewed?: boolean): ReviewState {
  if (reviewed) return 'reviewed';
  if (assessment.confidence < 70 || assessment.warnings.some(w =>
    ['缺選項', '題號不合法', '題幹長度異常', '答案不在選項內'].includes(w))) return 'anomaly';
  return assessment.confidence >= 90 && !assessment.warnings.length ? 'passed' : 'needs-review';
}
