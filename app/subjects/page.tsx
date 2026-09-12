"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { StudyIcon, type StudyIconName } from "@/components/dashboard/StudyUI";
import { subjectPalette } from "@/app/analysis/analytics";
import analysisStyles from "@/app/analysis/analysis.module.css";
import styles from "./subjects.module.css";
import { formatExamYear } from "@/lib/exam-year";

type Row = { subject: string; years: number[]; count: string };

const subjects = ["獸醫病理學", "獸醫藥理學", "獸醫實驗診斷學", "獸醫普通疾病學", "獸醫傳染病學", "獸醫公共衛生學"];
const subjectIcons: Record<string, StudyIconName> = {
  獸醫病理學: "leaf",
  獸醫藥理學: "file",
  獸醫實驗診斷學: "search",
  獸醫普通疾病學: "heart",
  獸醫傳染病學: "target",
  獸醫公共衛生學: "book",
};

export default function SubjectsPage() {
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [order, setOrder] = useState<"original" | "random">("random");
  const [available, setAvailable] = useState<{ subject: string; year: number | null; count: number }[]>([]);
  const [mode, setMode] = useState("practice");
  const [error, setError] = useState("");
  const [loadingAvailable, setLoadingAvailable] = useState(false);

  function openSettings(subject: string) { setSelectedSubject(subject); setRows([{ subject, years: [], count: "10" }]); setOrder("random"); }
  function addRow() { const used = new Set(rows.map((r) => r.subject)); const nextSubject = subjects.find((s) => !used.has(s)) ?? subjects[0]; setRows((r) => [...r, { subject: nextSubject, years: [], count: "10" }]); }
  function removeRow(index: number) { setRows((r) => r.filter((_, i) => i !== index)); }
  function updateRow(index: number, patch: Partial<Row>) { setRows((r) => r.map((row, i) => (i === index ? { ...row, ...patch } : row))); }

  useEffect(() => {
    if (!selectedSubject) return;
    const controller = new AbortController();
    async function loadAvailable() {
      setLoadingAvailable(true); setError("");
      try {
        const response = await fetch("/api/quiz?scope=public&settings=1", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "取得年份失敗");
        setAvailable(data.availability);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "取得年份失敗"); }
      finally { if (!controller.signal.aborted) setLoadingAvailable(false); }
    }
    loadAvailable();
    return () => controller.abort();
  }, [selectedSubject]);

  function availableCount(row: Row) {
    return available.filter((a) => a.subject === row.subject && (!row.years.length || (a.year !== null && row.years.includes(a.year)))).reduce((sum, a) => sum + Number(a.count), 0);
  }

  function buildQuizUrl() {
    return `/questions?${new URLSearchParams({ groups: JSON.stringify(rows), order, mode, started: "1" })}`;
  }

  const totalCount = rows.reduce((sum, row) => sum + Math.min(availableCount(row), row.count === "all" ? Infinity : Number(row.count) || 0), 0);
  const invalid = loadingAvailable || !!error || rows.some((r) => r.count !== "all" && (!Number.isInteger(Number(r.count)) || Number(r.count) < 1));

  return <main className={`${analysisStyles.page}`}><div className={analysisStyles.container}>
    <nav className={analysisStyles.breadcrumb} aria-label="麵包屑"><Link href="/" aria-label="回首頁"><StudyIcon name="home" />首頁</Link><span aria-hidden="true">/</span><span aria-current="page">選擇科目</span></nav>
    <header className={analysisStyles.header}><div><h1>選擇科目</h1><p>選擇你想練習的科目，開始今天的刷題。</p></div><Link href="/most-missed" className="study-button"><StudyIcon name="target" />最多人答錯</Link></header>
    <div className={styles.grid}>{subjects.map((subject) => <button
      key={subject}
      type="button"
      onClick={() => openSettings(subject)}
      aria-label={`選擇${subject}，設定練習`}
      aria-haspopup="dialog"
      className={styles.card}
      style={{ "--subject-main": subjectPalette[subject].main, "--subject-light": subjectPalette[subject].light } as CSSProperties}
    >
      <span className={styles.icon}><StudyIcon name={subjectIcons[subject]} /></span>
      <span className={styles.title}>{subject}</span>
      <span className={styles.description}>設定科目、年份與題數</span>
      <span className={styles.action}>開始練習 <StudyIcon name="arrow" /></span>
    </button>)}</div>
  </div>

  {selectedSubject && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]">
    <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-gray-100 bg-white p-6 shadow-xl md:p-8">
      <div className="flex items-start justify-between"><div><h2 className="text-2xl font-bold">開始刷題</h2><p className="mt-1 text-gray-500">每組條件獨立出題，題數不足時使用全部符合題目；重複題目只計一次。</p></div><button onClick={() => setSelectedSubject(null)} className="min-h-11 min-w-11 rounded-full px-3 py-2 text-[#6F7873] hover:bg-[#E9F2ED]">✕</button></div>
      <div className="mt-6 space-y-4">{rows.map((row, index) => <div key={index} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4"><div className="grid gap-3 md:grid-cols-2 md:items-end">
        <label><span className="text-sm font-bold text-gray-600">科目</span><select value={row.subject} onChange={(e) => updateRow(index, { subject: e.target.value, years: [] })} className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3">{subjects.map((s) => <option key={s}>{s}</option>)}</select></label>
        <fieldset className="min-w-0"><legend className="text-sm font-bold text-gray-600">考試年份（可多選）</legend><div className="mt-1 flex flex-wrap gap-2">
          <button aria-pressed={!row.years.length} onClick={() => updateRow(index, { years: [] })} className={"study-button " + (!row.years.length ? "study-button-primary" : "")}>全部年份</button>
          {available.filter((a) => a.subject === row.subject && a.year !== null).map((a) => a.year as number).map((year) => <button key={year} aria-pressed={row.years.includes(year)} onClick={() => updateRow(index, { years: row.years.includes(year) ? row.years.filter((y) => y !== year) : [...row.years, year] })} className={"study-button " + (row.years.includes(year) ? "study-button-primary" : "")}>{formatExamYear(year)}</button>)}
        </div></fieldset>
        <fieldset className="min-w-0 md:col-span-2"><legend className="text-sm font-bold text-gray-600">本次要做幾題？</legend><div className="mt-2 flex flex-wrap gap-2">{["10", "20", "40", "all"].map((count) => <button key={count} aria-pressed={row.count === count} onClick={() => updateRow(index, { count })} className={"study-button " + (row.count === count ? "study-button-primary" : "")}>{count === "all" ? "全部" : count + " 題"}</button>)}</div><label className="mt-2 block text-sm text-gray-600">自訂題數<input type="number" min={1} step={1} value={row.count === "all" ? "" : row.count} placeholder="全部" onChange={(e) => updateRow(index, { count: e.target.value || "all" })} className="mt-1 w-full rounded-xl border border-gray-200 bg-white p-3" /></label></fieldset>
        {rows.length > 1 && <button onClick={() => removeRow(index)} className="rounded-xl px-3 py-3 text-red-500 hover:bg-red-50">刪除</button>}
      </div><p className="mt-2 text-sm text-gray-500">{loadingAvailable ? "正在查詢可用題目…" : `符合條件共有 ${availableCount(row)} 題`}</p></div>)}</div>
      {rows.length < subjects.length && <button onClick={addRow} className="mt-4 w-full rounded-2xl border-2 border-dashed border-gray-200 p-4 font-bold text-[#3F725F] hover:bg-[#E9F2ED]">＋ 新增一組科目／年份／題數</button>}
      <section className="mt-7"><h3 className="font-bold">題目順序</h3><div className="mt-3 grid grid-cols-2 gap-3"><button onClick={() => setOrder("original")} className={`rounded-2xl border p-4 text-left transition ${order === "original" ? "border-[#5F8F7B] bg-[#E9F2ED] ring-1 ring-[#E9F2ED]" : "border-gray-200 hover:bg-gray-50"}`}><b>原始順序</b><div className="mt-1 text-sm text-gray-500">依年份、原題題號排列</div></button><button onClick={() => setOrder("random")} className={`rounded-2xl border p-4 text-left transition ${order === "random" ? "border-[#5F8F7B] bg-[#E9F2ED] ring-1 ring-[#E9F2ED]" : "border-gray-200 hover:bg-gray-50"}`}><b>隨機順序</b><div className="mt-1 text-sm text-gray-500">每次測驗重新打亂</div></button></div></section>
      <section className="mt-7"><h3 className="font-bold">答題模式</h3><div className="mt-3 grid grid-cols-2 gap-3">{[["practice", "練習模式", "選答案後立即顯示解析"], ["exam", "模擬考模式", "交卷後才顯示答案與成績"]].map(([value, label, description]) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)} className={"rounded-2xl border p-4 text-left " + (mode === value ? "border-[#5F8F7B] bg-[#E9F2ED]" : "border-gray-200 hover:bg-gray-50")}><b>{label}</b><p className="mt-1 text-sm text-gray-500">{description}</p></button>)}</div></section>
      {error && <p role="alert" className="mt-4 text-red-600">{error}，請關閉設定後再試一次。</p>}
      <div className="mt-7 rounded-2xl bg-gray-50 p-4"><div className="text-sm text-gray-500">本次測驗</div><div className="mt-1 text-2xl font-bold">最多 {totalCount} 題</div>{invalid && <p className="mt-2 text-sm text-red-600">請確認每組題數為至少 1 的整數，並等待年份載入。</p>}</div>
      <div className="mt-7 flex gap-3"><button onClick={() => setSelectedSubject(null)} className="flex-1 rounded-2xl border border-gray-200 px-5 py-3">取消</button><Link href={invalid ? "#" : buildQuizUrl()} onClick={(e) => { if (invalid) e.preventDefault(); else setSelectedSubject(null); }} className={`flex-1 rounded-2xl px-5 py-3 text-center font-bold text-white ${invalid ? "bg-gray-300" : "bg-[#5F8F7B] hover:bg-[#507B69]"}`}>開始刷題 →</Link></div>
    </div>
  </div>}
  </main>;
}
