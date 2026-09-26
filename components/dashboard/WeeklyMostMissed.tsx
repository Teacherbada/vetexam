"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
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

export default function WeeklyMostMissed({ variant, loading }: { variant?: "homepage"; loading?: ReactNode } = {}) {
  const [result, setResult] = useState<{ question: Question | null; min_attempts: number; source: 'weekly' | 'random_fallback' | null } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [challengeStarted, setChallengeStarted] = useState(false);

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
  const fallback = result?.source === 'random_fallback';
  return <section className="study-card study-weekly" aria-labelledby="weekly-title">
    <div className={variant === "homepage" ? "study-section-heading" : undefined}><h2 id="weekly-title"><StudyIcon name="wrong" />{fallback ? '今日隨機挑戰' : '本週最多人答錯'}</h2>{variant === "homepage" && <Link href="/most-missed" className="study-text-link">查看更多<StudyIcon name="arrow" /></Link>}</div>
    <p className="study-muted study-weekly-period">{fallback ? '本週統計累積中，先來挑戰一題。' : '本週一至今・台灣時間'}</p>
    <div aria-live="polite">
      {error ? <div className="study-weekly-state"><p>暫時無法載入本週錯題。</p><button className="study-text-link" onClick={() => { setError(false); setRetry((value) => value + 1); }}>重新載入 <StudyIcon name="arrow" /></button></div>
        : !result ? loading ?? <p className="study-weekly-state">正在整理本週錯題…</p>
        : question ? <>
          <div className={variant === "homepage" ? "study-weekly-entry" : undefined} data-source={result.source}>
          {variant === "homepage" && !fallback && <span className="study-weekly-rank" aria-label="本週第一名">1</span>}
          <div className="study-weekly-copy"><p className="study-weekly-meta">{question.exam_subject} · 第 {question.question_number} 題</p>
          {!challengeOpen && <p className="study-weekly-question">{question.question}</p>}
          {!fallback && <p className="study-weekly-stats"><strong>{question.wrong_attempts} 人答錯</strong><span>／{question.total_attempts} 人作答</span></p>}</div>
          {variant === "homepage" && !fallback && question.total_attempts > 0 && <p className="study-weekly-rate"><strong>{Math.round(question.wrong_attempts / question.total_attempts * 100)}%</strong><small>答錯率</small></p>}
          {variant !== "homepage" && <button onClick={() => setChallengeOpen(true)} className="study-text-link">挑戰這題 <StudyIcon name="arrow" /></button>}
          </div>
          {variant === "homepage" && <>
            <button className="study-text-link study-weekly-toggle" aria-expanded={challengeOpen} aria-controls="weekly-inline-challenge" onClick={() => { setChallengeStarted(true); setChallengeOpen((open) => !open); }}>
              {challengeOpen ? '收合題目' : '挑戰這題'} <StudyIcon name="arrow" />
            </button>
            <div id="weekly-inline-challenge" hidden={!challengeOpen}>
              {challengeStarted && <WeeklyQuestionDialog key={question.question_id} questionId={question.question_id} title={fallback ? '今日隨機挑戰' : '本週最多人答錯'} inline />}
            </div>
          </>}
        </> : <div className="study-weekly-state"><p>本週作答資料累積中</p><small>每題滿 {result.min_attempts} 人作答後，顯示答錯人數最多的題目。</small><Link href="/subjects" className="study-text-link">先來刷題 <StudyIcon name="arrow" /></Link></div>}
    </div>
    {variant !== "homepage" && challengeOpen && question && <WeeklyQuestionDialog questionId={question.question_id} title={fallback ? '今日隨機挑戰' : undefined} onClose={() => setChallengeOpen(false)} />}
  </section>;
}
