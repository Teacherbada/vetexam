"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import SubjectsPage from "@/app/subjects/page";
import { useSearchParams } from "next/navigation";
import { saveProgress } from "@/data/progress";
import { saveWrongQuestion } from "@/data/wrongAnswers";
import { addDailyProgress } from "@/data/tasksProgress";
import { getFavorites, toggleFavorite } from "@/data/favorites";
import Link from "next/link";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import styles from "./quiz.module.css";
import { formatExamYear } from "@/lib/exam-year";
import OptionDistribution from "@/components/questions/OptionDistribution";
import { sendStatistics } from "@/lib/answer-statistics-client";

type Question = { id: number; questionSetId: number; questionNumber: number; subject: string; question: string; options: string[]; answer: string; explanation: string; examYear: number | null; questionSetName: string };

function QuestionsContent() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const started = searchParams.get("started") === "1";
  const mode = searchParams.get("mode") === "exam" ? "exam" : "practice";
  const [attempt, setAttempt] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const submitted = useRef(false);
  const locked = useRef(new Set<number>());
  const order = searchParams.get("order") === "random" ? "random" : "original";
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [favorites, setFavorites] = useState<Question[]>([]);
  const [answered, setAnswered] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    // Hydrate the existing browser-only favorites after the initial render.
    const timer = window.setTimeout(() => setFavorites(getFavorites()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!started) return;
    const controller = new AbortController();
    async function loadQuestions() {
      try {
        setLoading(true); setError("");
        const params = new URLSearchParams(query);
        params.set("scope", "public");
        const response = await fetch(`/api/quiz?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "取得題目失敗");
        const loaded = (data.questions ?? []) as Question[];
        if (controller.signal.aborted) return;
        setQuestions(loaded); setAnswers({}); submitted.current = false; locked.current.clear();
        setCurrentIndex(0); setSelected(""); setShowResult(false); setScore(0); setAnswered(false); setFinished(false);
      } catch (e) { if (!controller.signal.aborted) { setQuestions([]); setError(e instanceof Error ? e.message : "取得題目失敗"); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    loadQuestions();
    return () => controller.abort();
  }, [query, started, attempt]);

  const currentQuestion = questions[currentIndex];
  if (!started) return <SubjectsPage />;
  if (loading) return <main className={styles.page}><div className={styles.state}><p className="text-xl font-bold">題目載入中...</p><p className="mt-2 text-gray-500">正在準備你的測驗</p></div></main>;
  if (error) return <main className={styles.page}><div className={styles.state}><h1 className="text-2xl font-bold text-red-600">無法取得題目</h1><p className="mt-4 text-gray-600">{error}</p><div className="mt-6"><Link href="/subjects" className="study-button">回到設定</Link></div></div></main>;
  if (questions.length === 0) return <main className={styles.page}><div className={styles.state}><h1 className="text-2xl font-bold">目前沒有符合條件的題目</h1><p className="mt-4 text-gray-500">目前沒有符合這些條件的題目，請調整年份或其他篩選條件。</p><div className="mt-6"><Link href="/subjects" className="study-button">回到設定</Link></div></div></main>;
  if (!currentQuestion) return null;

  function recordAnswer(question: Question, answer: string) {
    addDailyProgress();
    const correct = answer === question.answer;
    saveProgress(question.id, correct, question.subject);
    if (!correct) saveWrongQuestion(question, answer);
    return correct;
  }
  function submitExam(finalAnswers = answers) {
    if (submitted.current) return;
    submitted.current = true;
    let correct = 0;
    for (const question of questions) {
      const answer = finalAnswers[question.id];
      if (answer && recordAnswer(question, answer)) correct++;
    }
    setScore(correct); setFinished(true);
    void sendStatistics(questions.filter((question) => finalAnswers[question.id]).map((question) => ({
      question_id: question.id, selected_answer: finalAnswers[question.id],
    })));
  }
  function chooseAnswer(letter: string) {
    if (submitted.current || (mode === "practice" && locked.current.has(currentQuestion.id))) return;
    setSelected(letter);
    const updated = { ...answers, [currentQuestion.id]: letter };
    setAnswers(updated);
    if (mode === "exam") {
      if (Object.keys(updated).length === questions.length) submitExam(updated);
      return;
    }
    locked.current.add(currentQuestion.id);
    setShowResult(true); setAnswered(true);
    if (recordAnswer(currentQuestion, letter)) setScore((prev) => prev + 1);
    void sendStatistics([{ question_id: currentQuestion.id, selected_answer: letter }]);
  }
  function nextQuestion() { if (currentIndex < questions.length - 1) { setCurrentIndex((p) => p + 1); setSelected(answers[questions[currentIndex + 1].id] || ""); setShowResult(false); setAnswered(false); } else setFinished(true); }
  function restartQuiz() { setLoading(true); setAttempt((value) => value + 1); }
  function exitQuiz() { if (window.confirm("確定要退出測驗嗎？\n\n目前測驗進度將會重置。")) window.location.href = "/subjects"; }
  function favoriteQuestion() { setFavorites(toggleFavorite(currentQuestion)); }

  if (finished) return <main className={styles.page}><div className={styles.container}><section className={styles.state}><span className={styles.badge}><StudyIcon name="check" /></span><h1>完成這次測驗了</h1><p>每一題的累積，都讓你更進一步。</p><div className={styles.resultScore}>{score} / {questions.length}</div><p>正確率 {Math.round(score / questions.length * 100)}% · 未作答 {questions.length - Object.keys(answers).length} 題</p><div className={styles.actions}><Link href="/" className="study-button">回首頁</Link><Link href="/subjects" className="study-button">回到設定</Link><button onClick={restartQuiz} className="study-button study-button-primary">重新測驗 <StudyIcon name="arrow" /></button></div></section>
    <h2 className="mb-4 text-xl font-bold">題目回顧</h2>{questions.map((question, index) => <article key={question.id} className={styles.card + " mb-4"}>
      <div className={styles.meta}><span>第 {index + 1} 題 · {question.subject}</span><button className={styles.favorite} aria-pressed={favorites.some((item) => item.id === question.id)} onClick={() => setFavorites(toggleFavorite(question))}><StudyIcon name="heart" />{favorites.some((item) => item.id === question.id) ? "已收藏" : "收藏題目"}</button></div>
      <h3 className={styles.question}>{question.question}</h3>
      {question.options.map((option, optionIndex) => <p key={optionIndex} className={styles.explanationText}>{String.fromCharCode(65 + optionIndex)}. {option}</p>)}
      <section className={styles.explanation}><p className={answers[question.id] === question.answer ? styles.correctText : styles.wrongText}>{!answers[question.id] ? "未作答" : answers[question.id] === question.answer ? "✓ 正確" : "✗ 錯誤"}</p><p>你的答案：{answers[question.id] || "未作答"} · 正確答案：{question.answer || "未提供"}</p>{question.explanation && <><h2>解析</h2><p className={styles.explanationText}>{question.explanation}</p></>}</section>
      <OptionDistribution questionId={question.id} selectedAnswer={answers[question.id] || ""} correctAnswer={question.answer} />
    </article>)}</div></main>;

  const isFavorite = favorites.some((item) => item.id === currentQuestion.id);
  const completedCount = Object.keys(answers).length;
  return <main className={styles.page}><div className={styles.container}>
    <header className={styles.topbar}><span><StudyIcon name="paw" />VetExam <small>專心練習，一題一步</small></span><button onClick={exitQuiz} className="study-button">退出測驗</button></header>
    <section className={styles.card} aria-label="本次練習">
      <div className={styles.meta}><span>{currentQuestion.subject}{currentQuestion.examYear ? ` · ${formatExamYear(currentQuestion.examYear)}` : ""}</span><span className={styles.tag}>{mode === "exam" ? "模擬考" : "練習"} · {order === "random" ? "隨機順序" : "原始順序"}</span></div>
      <div className={styles.progressLabel}><span>第 <strong>{currentIndex + 1}</strong> / {questions.length} 題</span><span>已完成 {completedCount} 題{mode === "practice" && " · 答對 " + score + " 題"}</span></div>
      <div className={styles.progress} role="progressbar" aria-label="已完成題數" aria-valuenow={completedCount} aria-valuemin={0} aria-valuemax={questions.length}><span style={{ width: `${completedCount / questions.length * 100}%` }} /></div>
      <div className={styles.questionHeader}><span>單選題</span><button onClick={favoriteQuestion} aria-pressed={isFavorite} className={styles.favorite}><StudyIcon name="heart" />{isFavorite ? "已收藏" : "收藏題目"}</button></div>
      <h1 className={styles.question} key={currentQuestion.id}>{currentQuestion.question}</h1>
      <div className={styles.options} role="group" aria-label="答案選項">{currentQuestion.options.map((option, index) => {
        const letter = String.fromCharCode(65 + index);
        const correctOption = showResult && letter === currentQuestion.answer;
        const wrongOption = showResult && selected === letter && !correctOption;
        return <button key={`${currentQuestion.id}-${index}`} disabled={answered} aria-pressed={selected === letter} onClick={() => chooseAnswer(letter)} className={`${styles.option} ${correctOption ? styles.correct : wrongOption ? styles.wrong : selected === letter ? styles.selected : ""}`}><span className={styles.letter}>{letter}</span><span className={styles.optionText}>{option}</span>{correctOption && <span className={styles.answerStatus}>✓ 正確答案</span>}{wrongOption && <span className={styles.answerStatus}>✗ 你的答案</span>}</button>;
      })}</div>
      {showResult && <section className={styles.explanation} aria-label="答案與解析"><p role="status" className={selected === currentQuestion.answer ? styles.correctText : styles.wrongText}>{selected === currentQuestion.answer ? "✓ 答對了，正確答案：" + currentQuestion.answer : `✗ 答錯了，答案是 ${currentQuestion.answer || "未提供"}`}</p><h2>解析</h2><p className={styles.explanationText}>{currentQuestion.explanation || "目前沒有提供解析。"}</p></section>}
      {mode === "practice" && showResult && <OptionDistribution key={currentQuestion.id} questionId={currentQuestion.id} selectedAnswer={selected} correctAnswer={currentQuestion.answer} />}
      <div className={styles.actions}>{mode === "exam" ? <>
        <button disabled={currentIndex === 0} onClick={() => { setCurrentIndex((value) => value - 1); setSelected(answers[questions[currentIndex - 1].id] || ""); }} className="study-button">上一題</button>
        {currentIndex < questions.length - 1 && <button onClick={nextQuestion} className="study-button">下一題 <StudyIcon name="arrow" /></button>}
        <button onClick={() => submitExam()} className="study-button study-button-primary">交卷</button>
      </> : showResult ? <><p>看懂解析，讓這一題更有收穫。</p><button onClick={nextQuestion} className="study-button study-button-primary">{currentIndex < questions.length - 1 ? "下一題" : "完成測驗"}<StudyIcon name="arrow" /></button></> : <p>點選答案後即鎖定，並顯示答案與解析。</p>}</div>
    </section>
  </div></main>;
}

export default function QuestionsPage() { return <Suspense fallback={<main className={styles.page}><div className={styles.state} role="status">載入題目中…</div></main>}><QuestionsContent /></Suspense>; }
