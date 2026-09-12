"use client";

import { useEffect, useRef, useState } from "react";
import OptionDistribution from "@/components/questions/OptionDistribution";
import { sendStatistics } from "@/lib/answer-statistics-client";
import { saveProgress } from "@/data/progress";
import { saveWrongQuestion } from "@/data/wrongAnswers";
import { addDailyProgress } from "@/data/tasksProgress";
import { formatExamYear } from "@/lib/exam-year";
import styles from "@/app/questions/quiz.module.css";
import dialogStyles from "./weekly-question-dialog.module.css";

type Question = { id: number; questionSetId: number; questionNumber: number; subject: string; question: string; options: string[]; answer: string; explanation: string; examYear: number | null; questionSetName: string };

export default function WeeklyQuestionDialog({ questionId, onClose }: { questionId: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const locked = useRef(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/quiz?scope=public&questionId=${questionId}`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Question unavailable");
      const data = await response.json();
      if (!data.questions?.[0]) throw new Error("Question missing");
      if (!controller.signal.aborted) setQuestion(data.questions[0]);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [questionId, retry]);

  const answer = question?.answer.trim().toUpperCase() ?? "";
  const hasAnswer = /^[A-E]$/.test(answer) && Boolean(question?.options[answer.charCodeAt(0) - 65]?.trim());
  function choose(letter: string) {
    if (!question || locked.current) return;
    locked.current = true;
    setSelected(letter);
    if (hasAnswer) {
      addDailyProgress();
      saveProgress(question.id, letter === answer, question.subject);
      if (letter !== answer) saveWrongQuestion(question, letter);
      void sendStatistics([{ question_id: question.id, selected_answer: letter }]);
    }
  }

  return <dialog ref={dialog} className={dialogStyles.dialog} aria-labelledby="weekly-question-title" onClose={onClose}>
    <div className={dialogStyles.header}><h2 id="weekly-question-title">本週魔王題</h2><button className="study-button" onClick={() => dialog.current?.close()} autoFocus>關閉</button></div>
    {error ? <div role="status"><p>暫時無法載入題目。</p><button className="study-button" onClick={() => { setError(false); setRetry((value) => value + 1); }}>重新載入</button></div>
      : !question ? <p role="status">載入題目中…</p> : <>
        <p className={styles.meta}>{question.subject} · {formatExamYear(question.examYear)} · 第 {question.questionNumber} 題</p>
        <h3 className={styles.question}>{question.question}</h3>
        <div className={styles.options} role="group" aria-label="本週魔王題答案選項">{question.options.map((option, index) => {
          if (!option.trim()) return null;
          const letter = String.fromCharCode(65 + index);
          const correct = Boolean(selected) && hasAnswer && letter === answer;
          const wrong = selected === letter && hasAnswer && !correct;
          return <button key={letter} className={`${styles.option} ${correct ? styles.correct : wrong ? styles.wrong : selected === letter ? styles.selected : ""}`} disabled={Boolean(selected)} aria-pressed={selected === letter} onClick={() => choose(letter)}><span className={styles.letter}>{letter}</span><span className={styles.optionText}>{option}</span>{correct && <span className={styles.answerStatus}>正確答案</span>}{selected === letter && <span className={styles.answerStatus}>你的答案</span>}</button>;
        })}</div>
        {selected && <>
          <section className={styles.explanation} aria-label="答案與解析"><p role="status" className={hasAnswer ? selected === answer ? styles.correctText : styles.wrongText : undefined}>{hasAnswer ? `你的答案：${selected} · 正確答案：${answer}` : "本題尚未提供正確答案，暫不計入作答統計。"}</p><h2>官方解析</h2><p className={styles.explanationText}>{question.explanation || "目前沒有提供解析。"}</p></section>
          <OptionDistribution questionId={question.id} selectedAnswer={selected} correctAnswer={answer} expanded />
        </>}
      </>}
  </dialog>;
}
