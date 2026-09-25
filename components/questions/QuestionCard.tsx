"use client";
import { StudyIcon } from '@/components/dashboard/StudyUI';
import { usableAnswer } from '@/lib/question-answer';
import styles from '@/app/questions/quiz.module.css';
export type QuizQuestion = { id: number; questionSetId: number; questionNumber: number; subject: string; question: string; options: string[]; answer: string; explanation: string; imageDataUrl?: string | null; examYear: number | null; questionSetName: string };
export default function QuestionCard({ currentQuestion, selected, showResult, answered, isFavorite, favoriteQuestion, chooseAnswer }: {
  currentQuestion: QuizQuestion; selected: string; showResult: boolean; answered: boolean;
  isFavorite: boolean; favoriteQuestion: () => void; chooseAnswer: (letter: string) => void;
}) {
  const currentAnswer = usableAnswer(currentQuestion);
  return <>
      <div className={styles.questionHeader}><span>單選題</span><button onClick={favoriteQuestion} aria-pressed={isFavorite} className={styles.favorite}><StudyIcon name="heart" />{isFavorite ? "已收藏" : "收藏題目"}</button></div>
      <h1 className={styles.question} key={currentQuestion.id}>{currentQuestion.question}</h1>
      {currentQuestion.imageDataUrl && <img key={`image-${currentQuestion.id}`} src={currentQuestion.imageDataUrl} alt={`第 ${currentQuestion.questionNumber} 題圖片`} className={styles.questionImage} />}
      <div className={styles.options} role="group" aria-label="答案選項">{currentQuestion.options.map((option, index) => {
        if (!option.trim()) return null;
        const letter = String.fromCharCode(65 + index);
        const correctOption = showResult && letter === currentAnswer;
        const wrongOption = showResult && Boolean(currentAnswer) && selected === letter && !correctOption;
        return <button key={`${currentQuestion.id}-${index}`} disabled={answered || !option.trim()} aria-pressed={selected === letter} onClick={() => chooseAnswer(letter)} className={`${styles.option} ${correctOption ? styles.correct : wrongOption ? styles.wrong : selected === letter ? styles.selected : ""}`}><span className={styles.letter}>{letter}</span><span className={styles.optionText}>{option}</span>{correctOption && <span className={styles.answerStatus}>✓ 正確答案</span>}{wrongOption && <span className={styles.answerStatus}>✗ 你的答案</span>}</button>;
      })}</div>
      {showResult && <section className={styles.explanation} aria-label="答案與解析"><p role="status" className={!currentAnswer ? undefined : selected === currentAnswer ? styles.correctText : styles.wrongText}>{!currentAnswer ? "本題正確答案尚未設定，不計入作答統計。" : selected === currentAnswer ? "✓ 答對了，正確答案：" + currentAnswer : `✗ 答錯了，答案是 ${currentAnswer}`}</p><h2>解析</h2><p className={styles.explanationText}>{currentQuestion.explanation || "目前沒有提供解析。"}</p></section>}
  </>;
}
