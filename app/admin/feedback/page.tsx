"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Report = { id:number; user_email:string|null; category:"bug"|"suggestion"; message:string; context:string|null; status:"open"|"resolved"; created_at:string };

export default function AdminFeedbackPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [message, setMessage] = useState("載入中…");
  useEffect(()=>{fetch("/api/admin/feedback",{cache:"no-store"}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||"讀取失敗。");setReports(data.reports||[]);setMessage("")}).catch(error=>setMessage(error instanceof Error?error.message:"讀取失敗。"))},[]);
  async function updateStatus(id:number,status:"open"|"resolved"){const response=await fetch("/api/admin/feedback",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status})});if(!response.ok)return;setReports(current=>current.map(report=>report.id===id?{...report,status}:report))}
  return <main className="min-h-screen bg-slate-50 px-4 py-10"><section className="mx-auto max-w-4xl"><Link href="/" className="text-sm font-semibold text-blue-700">← 回首頁</Link><h1 className="mt-5 text-3xl font-bold text-slate-900">使用者回報</h1>{message&&<p className="mt-6 rounded-xl bg-white p-4 text-slate-600">{message}</p>}<div className="mt-6 space-y-4">{reports.map(report=><article key={report.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2"><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{report.category==="bug"?"錯誤回報":"功能建議"}</span><span className={`rounded-full px-3 py-1 text-xs font-bold ${report.status==="resolved"?"bg-emerald-50 text-emerald-700":"bg-amber-50 text-amber-700"}`}>{report.status==="resolved"?"已處理":"待處理"}</span></div><button onClick={()=>updateStatus(report.id,report.status==="open"?"resolved":"open")} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">標記為{report.status==="open"?"已處理":"待處理"}</button></div><p className="mt-4 whitespace-pre-wrap text-slate-800">{report.message}</p>{report.context&&<p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">情境：{report.context}</p>}<p className="mt-4 text-xs text-slate-400">{report.user_email||"未提供 email"} · {new Date(report.created_at).toLocaleString("zh-TW")}</p></article>)}</div></section></main>;
}
