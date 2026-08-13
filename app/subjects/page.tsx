"use client";

import Link from "next/link";
import { useState } from "react";

const subjects = ["獸醫病理學", "獸醫藥理學", "獸醫實驗診斷學", "獸醫普通疾病學", "獸醫傳染病學", "獸醫公共衛生學"];
const years = Array.from({ length: 10 }, (_, index) => new Date().getFullYear() - 1911 - index);

export default function SubjectsPage() {
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [count, setCount] = useState("全部");
  const [order, setOrder] = useState<"original" | "random">("random");
  const [mixSubjects, setMixSubjects] = useState(false);
  const [mixYears, setMixYears] = useState(false);

  function openSettings(subject: string) {
    setSelectedSubject(subject); setSelectedSubjects([subject]); setSelectedYears([]);
    setCount("全部"); setOrder("random"); setMixSubjects(false); setMixYears(false);
  }
  function toggleSubject(subject: string) {
    setSelectedSubjects((current) => current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject]);
  }
  function toggleYear(year: number) {
    setSelectedYears((current) => current.includes(year) ? current.filter((item) => item !== year) : [...current, year]);
  }
  function buildQuizUrl() {
    const params = new URLSearchParams();
    params.set("subjects", selectedSubjects.join(","));
    if (selectedYears.length) params.set("years", selectedYears.join(","));
    params.set("count", count === "全部" ? "500" : count);
    params.set("order", order);
    return `/questions?${params.toString()}`;
  }

  const canStart = selectedSubjects.length > 0 || selectedYears.length > 0;

  return (
    <main className="min-h-screen bg-gray-100 p-10">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-8 text-4xl font-bold">📚 選擇科目</h1>
        <div className="grid gap-6 md:grid-cols-3">
          {subjects.map((subject) => (
            <button key={subject} type="button" onClick={() => openSettings(subject)} className="rounded-xl bg-white p-8 text-left shadow transition hover:-translate-y-1 hover:bg-blue-600 hover:text-white">
              <h2 className="text-xl font-bold">{subject}</h2><p className="mt-2 text-sm opacity-70">點擊後設定刷題條件</p>
            </button>
          ))}
        </div>
      </div>

      {selectedSubject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold">設定刷題</h2><p className="mt-1 text-gray-500">從「{selectedSubject}」開始設定</p></div><button onClick={() => setSelectedSubject(null)} className="rounded-lg px-3 py-2 text-gray-500 hover:bg-gray-100">✕</button></div>

            <section className="mt-6"><h3 className="font-bold">科目</h3>
              <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={mixSubjects} onChange={(e) => { setMixSubjects(e.target.checked); if (!e.target.checked) setSelectedSubjects([selectedSubject]); }} />混搭多個科目</label>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">{(mixSubjects ? subjects : [selectedSubject]).map((subject) => <label key={subject} className="flex cursor-pointer items-center gap-2 rounded-lg border p-3"><input type="checkbox" checked={selectedSubjects.includes(subject)} onChange={() => toggleSubject(subject)} />{subject}</label>)}</div>
            </section>

            <section className="mt-6"><h3 className="font-bold">年份</h3>
              <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={mixYears} onChange={(e) => { setMixYears(e.target.checked); if (!e.target.checked) setSelectedYears([]); }} />指定國考年份（可複選）</label>
              {mixYears && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{years.map((year) => <label key={year} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2"><input type="checkbox" checked={selectedYears.includes(year + 1911)} onChange={() => toggleYear(year + 1911)} />{year} 年</label>)}</div>}
            </section>

            <section className="mt-6"><h3 className="font-bold">題數</h3><div className="mt-3 grid grid-cols-4 gap-2">{["10", "20", "50", "全部"].map((value) => <button key={value} onClick={() => setCount(value)} className={`rounded-lg border p-3 ${count === value ? "border-blue-500 bg-blue-50 font-bold" : ""}`}>{value}</button>)}</div></section>

            <section className="mt-6"><h3 className="font-bold">題目順序</h3><div className="mt-3 grid grid-cols-2 gap-3">
              <button onClick={() => setOrder("original")} className={`rounded-lg border p-4 text-left ${order === "original" ? "border-blue-500 bg-blue-50" : ""}`}><b>🔢 原始順序</b><div className="text-sm text-gray-500">按照題庫題號</div></button>
              <button onClick={() => setOrder("random")} className={`rounded-lg border p-4 text-left ${order === "random" ? "border-blue-500 bg-blue-50" : ""}`}><b>🔀 隨機順序</b><div className="text-sm text-gray-500">每次重新打亂</div></button>
            </div></section>

            <div className="mt-8 flex gap-3"><button onClick={() => setSelectedSubject(null)} className="flex-1 rounded-xl border px-5 py-3">取消</button>{canStart ? <Link href={buildQuizUrl()} onClick={() => setSelectedSubject(null)} className="flex-1 rounded-xl bg-blue-600 px-5 py-3 text-center font-bold text-white hover:bg-blue-700">開始刷題</Link> : <button disabled className="flex-1 rounded-xl bg-gray-300 px-5 py-3 font-bold text-white">請先選擇條件</button>}</div>
          </div>
        </div>
      )}
    </main>
  );
}
