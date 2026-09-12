"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudyIcon } from "./StudyUI";
import WeeklyQuestionDialog from "./WeeklyQuestionDialog";

type Question = {
  question_id: number;
  question_number: number;
  exam_subject: string;
  question: string;
  wrong_attempts: number;
  total_attempts: number;
};

export default function WeeklyMostMissed() {
  const [result, setResult] = useState<{ question: Question | null; min_attempts: number } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [challengeOpen, setChallengeOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/stats/weekly-most-missed", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load weekly question");
        return response.json();
      })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [retry]);

  const question = result?.question;
  return <section className="study-card study-weekly" aria-labelledby="weekly-title">
    <h2 id="weekly-title"><StudyIcon name="wrong" />本週最多人答錯</h2>
    <p className="study-muted study-weekly-period">本週一至今・台灣時間</p>
    <div aria-live="polite">
      {error ? <div className="study-weekly-state"><p>暫時無法載入本週錯題。</p><button className="study-text-link" onClick={() => { setError(false); setRetry((value) => value + 1); }}>重新載入 <StudyIcon name="arrow" /></button></div>
        : !result ? <p className="study-weekly-state">正在整理本週錯題…</p>
        : question ? <>
          <p className="study-weekly-meta">{question.exam_subject} · 第 {question.question_number} 題</p>
          <p className="study-weekly-question">{question.question}</p>
          <p className="study-weekly-stats"><strong>{question.wrong_attempts} 人答錯</strong><span>／{question.total_attempts} 人作答</span></p>
          <button onClick={() => setChallengeOpen(true)} className="study-text-link">挑戰這題 <StudyIcon name="arrow" /></button>
        </> : <div className="study-weekly-state"><p>本週作答資料累積中</p><small>每題滿 {result.min_attempts} 人作答後，顯示答錯人數最多的題目。</small><Link href="/subjects" className="study-text-link">先來刷題 <StudyIcon name="arrow" /></Link></div>}
    </div>
    {challengeOpen && question && <WeeklyQuestionDialog questionId={question.question_id} onClose={() => setChallengeOpen(false)} />}
  </section>;
}
