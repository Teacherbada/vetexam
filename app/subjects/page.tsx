"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Row = { subject: string; year: number | "all"; count: string };

const subjects = ["獸醫病理學", "獸醫藥理學", "獸醫實驗診斷學", "獸醫普通疾病學", "獸醫傳染病學", "獸醫公共衛生學"];
const currentRocYear = new Date().getFullYear() - 1911;
const years = Array.from({ length: 30 }, (_, i) => currentRocYear - i);

export default function SubjectsPage() {
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [order, setOrder] = useState<"original" | "random">("random");
  const [available, setAvailable] = useState<Record<string, number>>({});
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  function openSettings(subject: string) { setSelectedSubject(subject); setRows([{ subject, year: "all", count: "10" }]); setOrder("random"); }
  function addRow() { const used = new Set(rows.map((r) => r.subject)); const nextSubject = subjects.find((s) => !used.has(s)) ?? subjects[0]; setRows((r) => [...r, { subject: nextSubject, year: "all", count: "10" }]); }
  function removeRow(index: number) { setRows((r) => r.filter((_, i) => i !== index)); }
  function updateRow(index: number, patch: Partial<Row>) { setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row))); }

  useEffect(() => {
    if (!selectedSubject) return;
    async function loadAvailable() {
      setLoadingAvailable(true);
      try {
        const params = new URLSearchParams(); params.set("subjects", rows.map((r) => r.subject).join(","));
        const response = await fetch(`/api/quiz?${params.toString()}&count=500`, { cache: "no-store" });
        const data = await response.json();
        if (response.ok) { const map: Record<string, number> = {}; for (const q of data.questions ?? []) map[q.subject] = (map[q.subject] ?? 0) + 1; setAvailable(map); }
      } finally { setLoadingAvailable(false); }
    }
    loadAvailable();
  }, [selectedSubject, rows.map((r) => r.subject).join(",")]);

  function buildQuizUrl() {
    const params = new URLSearchParams(); params.set("subjects", [...new Set(rows.map((r) => r.subject))].join(","));
    const selectedYears = rows.filter((r) => r.year !== "all").map((r) => Number(r.year) + 1911);
    if (selectedYears.length) params.set("years", [...new Set(selectedYears)].join(","));
    const total = rows.reduce((sum, r) => sum + (r.count === "all" ? available[r.subject] ?? 500 : Number(r.count) || 0), 0);
    params.set("count", String(Math.min(Math.max(total, 1), 500))); params.set("order", order); return `/questions?${params.toString()}`;
  }

  const totalCount = rows.reduce((sum, r) => sum + (r.count === "all" ? available[r.subject] ?? 0 : Number(r.count) || 0), 0);
  const invalid = rows.some((r) => !r.count || Number(r.count) < 1 || (r.count !== "all" && available[r.subject] !== undefined && Number(r.count) > available[r.subject]));

  return <main className="min-h-screen bg-gray-100 p-6 md:p-10"><div className="mx-auto max-w-5xl">
    <h1 className="mb-8 text-4xl font-bold">📚 選擇科目</h1>
    <div className="grid gap-6 md:grid-cols-3">{subjects.map((subject) => <button key={subject} type="button" onClick={() => openSettings(subject)} className="rounded-xl bg-white p-8 text-left shadow transition hover:-translate-y-1 hover:bg-blue-600 hover:text-white"><h2 className="text-xl font-bold">{subject}</h2><p className="mt-2 text-sm opacity-70">設定科目、年份與題數</p></button>)}</div>
  </div>

  {selectedSubject && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-gray-100 bg-white p-6 shadow-xl md:p-8">
      <div className="flex items-start justify-between"><div><h2 className="text-2xl font-bold">開始刷題</h2><p className="mt-1 text-gray-500">每一列都是一組獨立的刷題條件</p></div><button onClick={() => setSelectedSubject(null)} className="rounded-full px-3 py-2 text-gray-400 hover:bg-gray-100">✕</button></div>
      <div className="mt-6 space-y-4">{rows.map((row, index) => <div key={index} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4"><div className="grid gap-3 md:grid-cols-[1.5fr_1fr_110px_auto] md:items-end">
        <label><span className="text-sm font-bold text-gray-600">科目</span><select value={row.subject} onChange={(e) => updateRow(index, { subject: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3">{subjects.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label><span className="text-sm font-bold text-gray-600">考試年份</span><select value={row.year} onChange={(e) => updateRow(index, { year: e.target.value === "all" ? "all" : Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3"><option value="all">不限年份</option>{years.map((y) => <option key={y} value={y}>{y} 年（{y + 1911}）</option>)}</select></label>
        <label><span className="text-sm font-bold text-gray-600">題數</span><input type="number" min={1} value={row.count === "all" ? "" : row.count} placeholder="全部" onChange={(e) => updateRow(index, { count: e.target.value })} className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3" /></label>
        {rows.length > 1 && <button onClick={() => removeRow(index)} className="rounded-xl px-3 py-3 text-red-500 hover:bg-red-50">刪除</button>}
      </div><p className="mt-2 text-sm text-gray-500">{loadingAvailable ? "正在查詢可用題目…" : `此科目目前可用約 ${available[row.subject] ?? 0} 題`}</p></div>)}</div>
      {rows.length < subjects.length && <button onClick={addRow} className="mt-4 w-full rounded-2xl border-2 border-dashed border-gray-200 p-4 font-bold text-blue-600 hover:bg-blue-50">＋ 新增一組科目／年份／題數</button>}
      <section className="mt-7"><h3 className="font-bold">題目順序</h3><div className="mt-3 grid grid-cols-2 gap-3"><button onClick={() => setOrder("original")} className={`rounded-2xl border p-4 text-left transition ${order === "original" ? "border-blue-400 bg-blue-50 ring-1 ring-blue-100" : "border-gray-200 hover:bg-gray-50"}`}><b>🔢 原始順序</b><div className="mt-1 text-sm text-gray-500">依題庫題號排列</div></button><button onClick={() => setOrder("random")} className={`rounded-2xl border p-4 text-left transition ${order === "random" ? "border-blue-400 bg-blue-50 ring-1 ring-blue-100" : "border-gray-200 hover:bg-gray-50"}`}><b>🔀 隨機順序</b><div className="mt-1 text-sm text-gray-500">每次測驗重新打亂</div></button></div></section>
      <div className="mt-7 rounded-2xl bg-gray-50 p-4"><div className="text-sm text-gray-500">本次測驗</div><div className="mt-1 text-2xl font-bold">共 {totalCount} 題</div>{invalid && <p className="mt-2 text-sm text-red-600">請確認每組題數至少為 1，且不要超過可用題目。</p>}</div>
      <div className="mt-7 flex gap-3"><button onClick={() => setSelectedSubject(null)} className="flex-1 rounded-2xl border border-gray-200 px-5 py-3">取消</button><Link href={invalid || totalCount < 1 ? "#" : buildQuizUrl()} onClick={(e) => { if (invalid || totalCount < 1) e.preventDefault(); else setSelectedSubject(null); }} className={`flex-1 rounded-2xl px-5 py-3 text-center font-bold text-white ${invalid || totalCount < 1 ? "bg-gray-300" : "bg-blue-600 hover:bg-blue-700"}`}>開始刷題 →</Link></div>
    </div>
  </div>}
  </main>;
}
