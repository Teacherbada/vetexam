"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { saveProgress } from "@/data/progress";
import { saveWrongQuestion } from "@/data/wrongAnswers";
import { addDailyProgress } from "@/data/tasksProgress";
import { getFavorites, toggleFavorite } from "@/data/favorites";
import HomeButton from "@/components/HomeButton";

type Question = { id: number; questionSetId: number; questionNumber: number; subject: string; question: string; options: string[]; answer: string; explanation: string; examYear: number | null; questionSetName: string };

function shuffle(items: Question[]) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}

function QuestionsContent() {
  const searchParams = useSearchParams();
  const subjects = (searchParams.get("subjects") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const years = (searchParams.get("years") || "").split(",").map(Number).filter(Number.isInteger);
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
  if (loading) return <main className="min-h-screen bg-gray-100 p-10"><div className="mx-auto max-w-3xl rounded-xl bg-white p-8 text-center shadow"><p className="text-xl font-bold">題目載入中...</p><p className="mt-2 text-gray-500">正在準備你的測驗</p></div></main>;
  if (error) return <main className="min-h-screen bg-gray-100 p-10"><div className="mx-auto max-w-3xl rounded-xl bg-white p-8 text-center shadow"><h1 className="text-2xl font-bold text-red-600">無法取得題目</h1><p className="mt-4 text-gray-600">{error}</p><div className="mt-6"><HomeButton /></div></div></main>;
  if (questions.length === 0) return <main className="min-h-screen bg-gray-100 p-10"><div className="mx-auto max-w-3xl rounded-xl bg-white p-8 text-center shadow"><h1 className="text-2xl font-bold">目前沒有符合條件的題目</h1><p className="mt-4 text-gray-500">請換其他科目或年份。</p><div className="mt-6"><HomeButton /></div></div></main>;
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

  if (finished) return <main className="min-h-screen bg-gray-100 p-10"><div className="mx-auto max-w-3xl rounded-xl bg-white p-8 text-center shadow"><h1 className="text-4xl font-bold">🎉 測驗完成</h1><p className="mt-6 text-2xl">得分：{score}/{questions.length}</p><p className="mt-4 text-xl">正確率：{Math.round((score / questions.length) * 100)}%</p><div className="mt-8"><HomeButton /></div></div></main>;

  const isFavorite = favorites.some((item) => item.id === currentQuestion.id);
  return <main className="min-h-screen bg-gray-100 p-10"><div className="mx-auto max-w-3xl">
    <button onClick={exitQuiz} className="mb-6 rounded-lg bg-red-500 px-5 py-2 text-white hover:bg-red-600">🚪 退出測驗</button>
    <div className="rounded-xl bg-white p-8 shadow">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-blue-600">{currentQuestion.subject} {currentQuestion.examYear ? `· ${currentQuestion.examYear - 1911} 年` : ""} 第 {currentIndex + 1} / {questions.length} 題</p><span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">{order === "random" ? "🔀 隨機" : "🔢 原始"}</span></div>
      <p className="mt-2 text-gray-600">目前得分：{score}</p>
      <h1 className="mt-4 text-3xl font-bold">{currentQuestion.question}</h1>
      <button onClick={favoriteQuestion} className="mt-4 rounded-lg border px-4 py-2 hover:bg-gray-100">{isFavorite ? "★ 已收藏" : "☆ 收藏題目"}</button>
      <div className="mt-8 space-y-4">{currentQuestion.options.map((option, index) => { const letter = String.fromCharCode(65 + index); return <button key={`${currentQuestion.id}-${index}`} disabled={answered} onClick={() => setSelected(letter)} className={`w-full rounded-lg border p-4 text-left ${selected === letter ? "border-blue-500 bg-blue-100" : "hover:bg-gray-50"}`}>{letter}. {option}</button>; })}</div>
      {!showResult && <button onClick={checkAnswer} className="mt-8 rounded-lg bg-blue-600 px-6 py-3 text-white hover:bg-blue-700">確認答案</button>}
      {showResult && <div className="mt-8 rounded-lg bg-gray-100 p-5">{selected === currentQuestion.answer ? <p className="font-bold text-green-600">✓ 答對了</p> : <p className="font-bold text-red-600">✗ 答錯了，答案是 {currentQuestion.answer || "未提供"}</p>}<p className="mt-3"><span className="font-bold">解析：</span>{currentQuestion.explanation || "目前沒有提供解析。"}</p><button onClick={nextQuestion} className="mt-6 rounded-lg bg-green-600 px-6 py-3 text-white hover:bg-green-700">{currentIndex < questions.length - 1 ? "下一題 →" : "完成測驗"}</button></div>}
    </div>
  </div></main>;
}

export default function QuestionsPage() { return <Suspense fallback={<main className="min-h-screen bg-gray-100 p-10"><div className="mx-auto max-w-3xl rounded-xl bg-white p-8 text-center shadow">載入題目中...</div></main>}><QuestionsContent /></Suspense>; }
