/** Versioned collaboration contract. This phase supports export and read-only preview. */
export const HANDOFF_FORMAT = 'vetexam-explanations-v1';
export const EXPORT_FORMAT = 'vetexam-question-handoff-v1';
export type AnswerLetter = 'A' | 'B' | 'C' | 'D' | 'E';
export type StructuredExplanation = {
  questionId: number;
  questionFingerprint: string;
  sourceFingerprint: string;
  expectedAnswers: AnswerLetter[];
  explanationVersion: '1.0';
  coreConcept: string;
  optionExplanations: Partial<Record<AnswerLetter, string>>;
  correctAnswerReason: string;
  examMemory: string;
  extendedKnowledge: string;
  references: {
    title: string; url: string; version: string | null;
    applicableYears: number[] | 'unknown';
    supports: string[]; statement: string; verificationStatus: 'unverified';
  }[];
  doubts: {code: 'answer_dispute' | 'all_credit' | 'combined_choice' | 'missing_reference' | 'image_unclear' | 'other'; detail: string}[];
  reviewStatus: 'pending_review';
};
export type ExplanationHandoff = {formatVersion: typeof HANDOFF_FORMAT; explanations: StructuredExplanation[]};
export type HandoffAsset = {id: string; downloadUrl: string; filename: string; mediaType: string; requiresAdmin: true};
export type HandoffQuestion = {
  questionId: number; questionSetId: number; questionSetName: string;
  rocYear: number | null; exam_year: number | null; examSession: 'unknown';
  examSubject: string | null; subject: string | null; questionNumber: number | null;
  question: string; options: Record<AnswerLetter, string | null>;
  officialAnswers: string[]; rawAnswer: string | null;
  answerPolicy: 'any_accepted_option' | 'manual_review'; manualReviewReasons: string[];
  questionFingerprint: string; sourceFingerprint: string;
  sources: {officialQuestionSource: 'unknown'; officialAnswerSource: 'unknown'; correctionVersion: 'unknown'; importFilename: string | null; importFileHash: string | null; proofreadingVersion: string};
  images: {assetId: string; index: number}[];
};
export type QuestionHandoff = {formatVersion: typeof EXPORT_FORMAT; exportedAt: string; questions: HandoffQuestion[]; assets: HandoffAsset[]; nextAfterId: number | null; notice: string};
