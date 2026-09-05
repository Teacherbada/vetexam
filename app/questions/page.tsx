"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { saveProgress } from "@/data/progress";
import { saveWrongQuestion } from "@/data/wrongAnswers";
import { addDailyProgress } from "@/data/tasksProgress";
import { getFavorites, toggleFavorite } from "@/data/favorites";
import Link from "next/link";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import styles from "./quiz.module.css";

type Question = { id: number; questionSetId: number; questionNumber: number; subject: string; question: string; options: string[]; answer: string; explanation: string; examYear: number | null; questionSetName: string };

function shuffle(items: Question[]) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function QuestionsContent() {
  const searchParams = useSearchParams();
  const subjects = (searchParams.get("subjects") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const years = (searchParams.get("years") || "").split(",").map((year) => year.trim()).filter(Boolean).map(Number).filter(Number.isInteger);
  const order = searchParams.get("order") === "random" ? "random" : "original";
  const count = Number(searchParams.get("count") || 500);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [answered, setAnswered] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => { setFavorites(getFavorites()); }, []);

  useEffect(() => {
    async function loadQuestions() {
      if (subjects.length === 0 && years.length === 0) { setError("沒有指定測驗條件"); setLoading(false); return; }
      try {
        setLoading(true); setError("");
        const params = new URLSearchParams();
        if (subjects.length) params.set("subjects", subjects.join(","));
        if (years.length) params.set("years", years.join(","));
        params.set("count", String(Math.min(Math.max(count || 500, 1), 500)));
        params.set("order", order);
        const response = await fetch(`/api/quiz?${params.toString()}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "取得題目失敗");
        const loaded = (data.questions ?? []) as Question[];
        setQuestions(order === "random" ? shuffle(loaded) : loaded);
        setCurrentIndex(0); setSelected(""); setShowResult(false); setScore(0); setAnswered(false); setFinished(false);
      } catch (e) { setQuestions([]); setError(e instanceof Error ? e.message : "取得題目失敗"); }
      finally { setLoading(false); }
    }
    loadQuestions();
  }, [searchParams]);

  const currentQuestion = questions[currentIndex];
  if (loading) return <main className={styles.page}><div className={styles.state}><p className="text-xl font-bold">題目載入中...</p><p className="mt-2 text-gray-500">正在準備你的測驗</p></div></main>;
  if (error) return <main className={styles.page}><div className={styles.state}><h1 className="text-2xl font-bold text-red-600">無法取得題目</h1><p className="mt-4 text-gray-600">{error}</p><div className="mt-6"><Link href="/" className="study-button">回首頁</Link></div></div></main>;
  if (questions.length === 0) return <main className={styles.page}><div className={styles.state}><h1 className="text-2xl font-bold">目前沒有符合條件的題目</h1><p className="mt-4 text-gray-500">請換其他科目或年份。</p><div className="mt-6"><Link href="/" className="study-button">回首頁</Link></div></div></main>;
  if (!currentQuestion) return null;

  function checkAnswer() {
    if (answered) return;
    if (!selected) { alert("請先選擇一個答案！"); return; }
    addDailyProgress(); setShowResult(true); setAnswered(true);
    const correct = selected === currentQuestion.answer;
    saveProgress(currentQuestion.id, correct, currentQuestion.subject);
    if (correct) setScore((prev) => prev + 1); else saveWrongQuestion(currentQuestion, selected);
  }
  function nextQuestion() { if (currentIndex < questions.length - 1) { setCurrentIndex((p) => p + 1); setSelected(""); setShowResult(false); setAnswered(false); } else setFinished(true); }
  function exitQuiz() { if (window.confirm("確定要退出測驗嗎？\n\n目前測驗進度將會重置。")) window.location.href = "/subjects"; }
  function favoriteQuestion() { setFavorites(toggleFavorite(currentQuestion)); }

  if (finished) return <main className={styles.page}><section className={styles.state}><span className={styles.badge}><StudyIcon name="check" /></span><h1>完成這次練習了</h1><p>每一題的累積，都讓你更進一步。</p><div className={styles.resultScore}>{Math.round(score / questions.length * 100)}<small>%</small></div><p>答對 {score} / {questions.length} 題</p><div className={styles.actions}><Link href="/" className="study-button">回首頁</Link><Link href="/subjects" className="study-button study-button-primary">再練習一組 <StudyIcon name="arrow" /></Link></div></section></main>;

  const isFavorite = favorites.some((item) => item.id === currentQuestion.id);
  const completedCount = currentIndex + (answered ? 1 : 0);
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.topbar}><span><StudyIcon name="paw" />VetExam <small>專心練習，一題一步</small></span><button onClick={exitQuiz} className="study-button">退出測驗</button></header>
    <section className={styles.card} aria-label="本次練習">
      <div className={styles.meta}><span>{currentQuestion.subject}{currentQuestion.examYear ? ` · ${currentQuestion.examYear - 1911} 年` : ""}</span><span className={styles.tag}>{order === "random" ? "隨機順序" : "原始順序"}</span></div>
      <div className={styles.progressLabel}><span>第 <strong>{currentIndex + 1}</strong> / {questions.length} 題</span><span>已完成 {completedCount} 題 · 答對 {score} 題</span></div>
      <div className={styles.progress} role="progressbar" aria-label="已完成題數" aria-valuenow={completedCount} aria-valuemin={0} aria-valuemax={questions.length}><span style={{ width: `${completedCount / questions.length * 100}%` }} /></div>
      <div className={styles.questionHeader}><span>單選題</span><button onClick={favoriteQuestion} aria-pressed={isFavorite} className={styles.favorite}><StudyIcon name="heart" />{isFavorite ? "已收藏" : "收藏題目"}</button></div>
      <h1 className={styles.question} key={currentQuestion.id}>{currentQuestion.question}</h1>
      <div className={styles.options} role="group" aria-label="答案選項">{currentQuestion.options.map((option, index) => {
        const letter = String.fromCharCode(65 + index);
        const correctOption = showResult && letter === currentQuestion.answer;
        const wrongOption = showResult && selected === letter && !correctOption;
        return <button key={`${currentQuestion.id}-${index}`} disabled={answered} aria-pressed={selected === letter} onClick={() => setSelected(letter)} className={`${styles.option} ${correctOption ? styles.correct : wrongOption ? styles.wrong : selected === letter ? styles.selected : ""}`}><span className={styles.letter}>{letter}</span><span className={styles.optionText}>{option}</span>{correctOption && <span className={styles.answerStatus}>✓ 正確答案</span>}{wrongOption && <span className={styles.answerStatus}>✗ 你的答案</span>}</button>;
      })}</div>
      {showResult && <section className={styles.explanation} aria-label="答案與解析"><p role="status" className={selected === currentQuestion.answer ? styles.correctText : styles.wrongText}>{selected === currentQuestion.answer ? "✓ 答對了" : `✗ 答錯了，答案是 ${currentQuestion.answer || "未提供"}`}</p><h2>解析</h2><p className={styles.explanationText}>{currentQuestion.explanation || "目前沒有提供解析。"}</p></section>}
      <div className={styles.actions}>{!showResult ? <><p>選好答案後，再確認送出。</p><button onClick={checkAnswer} className="study-button study-button-primary">確認答案 <StudyIcon name="check" /></button></> : <><p>看懂解析，讓這一題更有收穫。</p><button onClick={nextQuestion} className="study-button study-button-primary">{currentIndex < questions.length - 1 ? "下一題" : "完成測驗"}<StudyIcon name="arrow" /></button></>}</div>
    </section>
  </div></main>;
}

export default function QuestionsPage() { return <Suspense fallback={<main className={styles.page}><div className={styles.state} role="status">載入題目中…</div></main>}><QuestionsContent /></Suspense>; }
