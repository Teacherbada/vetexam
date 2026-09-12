"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import { formatExamYear } from "@/lib/exam-year";
import styles from "@/app/questions/quiz.module.css";

type RankedQuestion = {
  question_id: number; question_number: number; exam_year: number | null; exam_subject: string;
  question: string; option_a: string; option_b: string; option_c: string; option_d: string;
  total_attempts: number; wrong_attempts: number; wrong_rate: number;
};
type Availability = { subject: string; year: number | null };

export default function MostMissedPage() {
  const [range, setRange] = useState("7d");
  const [subject, setSubject] = useState("");
  const [year, setYear] = useState("");
  const [available, setAvailable] = useState<Availability[]>([]);
  const [questions, setQuestions] = useState<RankedQuestion[]>([]);
  const [minimum, setMinimum] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/quiz?scope=public&settings=1", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (response.ok) setAvailable((await response.json()).availability ?? []); })
      .catch(() => {});
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      const params = new URLSearchParams({ range });
      if (subject) params.set("subject", subject);
      if (year) params.set("year", year);
      try {
        const response = await fetch(`/api/stats/most-missed?${params}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "排行榜暫時無法載入");
        if (controller.signal.aborted) return;
        setQuestions(data.questions); setMinimum(data.min_attempts);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "排行榜暫時無法載入");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [range, subject, year, retry]);

  const subjects = [...new Set(available.map((item) => item.subject))];
  const years = [...new Set(available.filter((item) => !subject || item.subject === subject).map((item) => item.year).filter((value): value is number => value !== null))].sort((a, b) => b - a);
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.topbar}><span><StudyIcon name="paw" />VetExam</span><Link href="/subjects" className="study-button">回到刷題</Link></header>
    <section className={styles.card}>
      <h1 className="text-2xl font-bold">最多人答錯</h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">看看大家容易卡住的題目，一起把觀念練熟。</p>
      <div className="mt-5 flex flex-wrap gap-3" role="group" aria-label="排行榜期間">
        {[['7d', '最近 7 天'], ['all', '全期間']].map(([value, label]) => <button key={value} aria-pressed={range === value} onClick={() => setRange(value)} className={`study-button ${range === value ? "study-button-primary" : ""}`}>{label}</button>)}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="min-w-0 text-sm">科目<select value={subject} onChange={(event) => { setSubject(event.target.value); setYear(""); }} className="mt-1 w-full min-w-0 rounded-xl border border-[var(--border)] bg-white p-3"><option value="">全部科目</option>{subjects.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="min-w-0 text-sm">年份<select value={year} onChange={(event) => setYear(event.target.value)} className="mt-1 w-full min-w-0 rounded-xl border border-[var(--border)] bg-white p-3"><option value="">全部年份</option>{years.map((value) => <option key={value} value={value}>{formatExamYear(value)}</option>)}</select></label>
      </div>
      <p className="mt-4 text-xs text-[var(--text-secondary)]">只統計登入使用者的首次作答。{minimum !== null && `每題在所選期間至少 ${minimum} 人作答才會上榜。`}最近 7 天不包含舊題重刷。</p>
    </section>
    {loading ? <div className={styles.state} role="status">正在整理排行榜…</div> : error ? <div className={styles.state}><p role="alert">{error}</p><button onClick={() => setRetry((value) => value + 1)} className="study-button mt-4">重新載入</button></div> : !questions.length ? <div className={styles.state}><h2 className="text-xl font-bold">還在累積大家的作答紀錄</h2><p>目前沒有達到樣本門檻的題目。可以調整篩選，或先開始今天的練習。</p><Link href="/subjects" className="study-button study-button-primary mt-4">開始刷題</Link></div> : <div className="mt-5 space-y-5">{questions.map((question, index) => <article key={question.question_id} className={styles.card}>
      <div className={styles.meta}><span>{index === 0 && range === "7d" ? "本週魔王題" : `第 ${index + 1} 名`}</span><span>VetExam</span></div>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">{formatExamYear(question.exam_year)}｜{question.exam_subject}｜第 {question.question_number} 題</p>
      <p className="mt-4 text-3xl font-semibold text-[#3F725F]">{question.wrong_rate}% 答錯</p>
      <p className="text-sm text-[var(--text-secondary)]">{question.wrong_attempts} / {question.total_attempts} 位使用者答錯</p>
      <h2 className={styles.question}>{question.question}</h2>
      <div className={styles.options}>{[question.option_a, question.option_b, question.option_c, question.option_d].map((option, optionIndex) => <div key={optionIndex} className={styles.option}><span className={styles.letter}>{String.fromCharCode(65 + optionIndex)}</span><span className={styles.optionText}>{option}</span></div>)}</div>
      <div className={styles.actions}><p>先試著作答，再看答案與解析。</p><Link prefetch={false} href={`/questions?started=1&mode=practice&questionId=${question.question_id}`} className="study-button study-button-primary">開始作答 <StudyIcon name="arrow" /></Link></div>
    </article>)}</div>}
  </div></main>;
}
