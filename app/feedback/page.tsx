"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function FeedbackPage() {
  const { data: session, isPending } = authClient.useSession();
  const [category, setCategory] = useState<"bug" | "suggestion">("bug");
  const [message, setMessage] = useState("");
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setNotice("");
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, message, context }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "送出回報失敗。");
      setMessage(""); setContext(""); setNotice(data.message);
    } catch (error) { setNotice(error instanceof Error ? error.message : "送出回報失敗。"); }
    finally { setSubmitting(false); }
  }

  return <main className="min-h-screen bg-slate-50 px-4 py-10"><section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8"><Link href="/" className="text-sm font-semibold text-blue-700">← 回首頁</Link><h1 className="mt-5 text-3xl font-bold text-slate-900">回報問題與建議</h1><p className="mt-2 text-slate-500">你的回報會直接提供給 VetExam 管理者，幫助我們改善實際使用體驗。</p>{isPending?<p className="mt-6 text-slate-500">確認登入狀態中…</p>:!session?.user?<div className="mt-6 rounded-2xl bg-amber-50 p-5 text-amber-800">請先登入後再回報。<Link href="/login" className="ml-2 font-bold underline">前往登入</Link></div>:<form onSubmit={submit} className="mt-6 space-y-5"><label className="block"><span className="text-sm font-bold text-slate-700">類型</span><select value={category} onChange={event=>setCategory(event.target.value as "bug"|"suggestion")} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3"><option value="bug">錯誤回報</option><option value="suggestion">功能建議</option></select></label><label className="block"><span className="text-sm font-bold text-slate-700">內容</span><textarea required minLength={5} maxLength={2000} value={message} onChange={event=>setMessage(event.target.value)} rows={7} placeholder="請描述你遇到的情況、預期結果，或你希望新增的功能。" className="mt-2 w-full rounded-xl border border-slate-200 p-3"/></label><label className="block"><span className="text-sm font-bold text-slate-700">發生位置或補充情境（選填）</span><input value={context} maxLength={500} onChange={event=>setContext(event.target.value)} placeholder="例如：PDF 匯入第 40 題、手機 Chrome" className="mt-2 w-full rounded-xl border border-slate-200 p-3"/></label>{notice&&<p className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{notice}</p>}<button disabled={submitting} className="rounded-xl bg-slate-900 px-5 py-3 font-bold text-white disabled:opacity-50">{submitting?"送出中…":"送出回報"}</button></form>}</section></main>;
}
