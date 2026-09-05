"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Report = { id: string; user_id: string; user_email: string | null; category: "bug" | "suggestion"; message: string; context: string | null; status: "open" | "resolved"; created_at: string; updated_at: string };
type Data = { reports: Report[]; total: number; pageSize: number };

export default function Reports() {
  const [filters, setFilters] = useState({ status: "all", category: "all", page: 1 });
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/reports?${new URLSearchParams({ ...filters, page: String(filters.page) })}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "讀取失敗。"); return result; })
      .then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [filters, revision]);
  function change(next: typeof filters) { setData(null); setError(""); setFilters(next); }
  async function updateStatus(report: Report) {
    setPending(report.id); setError("");
    try {
      const response = await fetch("/api/admin/reports", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: report.id, status: report.status === "open" ? "resolved" : "open" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "更新失敗。");
      change({ ...filters, page: 1 });
      setRevision(value => value + 1);
    } catch (error) { setError(error instanceof Error ? error.message : "更新失敗。"); }
    finally { setPending(null); }
  }
  return <main className="min-h-screen bg-slate-50 p-6"><section className="mx-auto max-w-4xl space-y-6">
    <Link href="/admin" className="text-blue-700">← 管理首頁</Link><h1 className="text-3xl font-bold">Reports 使用者回報</h1>
    <div className="flex flex-wrap gap-3">
      <select disabled={pending !== null} aria-label="回報狀態" value={filters.status} onChange={event => change({ ...filters, status: event.target.value, page: 1 })} className="rounded border bg-white p-2"><option value="all">全部狀態</option><option value="open">待處理</option><option value="resolved">已處理</option></select>
      <select disabled={pending !== null} aria-label="回報類別" value={filters.category} onChange={event => change({ ...filters, category: event.target.value, page: 1 })} className="rounded border bg-white p-2"><option value="all">全部類別</option><option value="bug">錯誤回報</option><option value="suggestion">功能建議</option></select>
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!data ? !error && <p role="status">載入中…</p> : <>
      <p>共 {data.total} 筆回報</p>
      {data.reports.length === 0 && <p>沒有符合條件的回報。</p>}
      {data.reports.map(report => <article key={report.id} className="space-y-3 rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="font-semibold">{report.category === "bug" ? "錯誤回報" : "功能建議"} · {report.status === "open" ? "待處理" : "已處理"}</p><button disabled={pending !== null} onClick={() => updateStatus(report)} className="rounded border px-3 py-2 disabled:opacity-40">{pending === report.id ? "更新中…" : `標記為${report.status === "open" ? "已處理" : "待處理"}`}</button></div>
        <p className="whitespace-pre-wrap break-words">{report.message}</p>
        <p className="break-all text-sm text-slate-600">{report.user_email || "未提供 email"} · {new Date(report.created_at).toLocaleString("zh-TW")}</p>
        <details><summary className="cursor-pointer text-blue-700">回報詳情</summary><dl className="mt-3 space-y-2 text-sm"><dt>回報 ID／會員 ID</dt><dd className="break-all">{report.id}／{report.user_id}</dd><dt>相關情境</dt><dd className="whitespace-pre-wrap break-words">{report.context || "未提供"}</dd><dt>最後更新</dt><dd>{new Date(report.updated_at).toLocaleString("zh-TW")}</dd></dl></details>
      </article>)}
      <div className="flex items-center gap-4"><button disabled={pending !== null || filters.page <= 1} className="rounded border p-2 disabled:opacity-40" onClick={() => change({ ...filters, page: filters.page - 1 })}>上一頁</button><span>第 {filters.page} 頁／共 {Math.max(1, Math.ceil(data.total / data.pageSize))} 頁</span><button disabled={pending !== null || filters.page * data.pageSize >= data.total} className="rounded border p-2 disabled:opacity-40" onClick={() => change({ ...filters, page: filters.page + 1 })}>下一頁</button></div>
    </>}
  </section></main>;
}
