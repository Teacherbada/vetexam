"use client";

import { useEffect, useState } from "react";
import { systemErrorEvents, type SystemErrorEvent, type SystemErrorKind } from "@/lib/system-error-events";

type Health = {
  checked_at: string;
  last_24_hours: number;
  last_7_days: number;
  errors: { id: string; event_code: string; error_kind: SystemErrorKind; created_at: string }[];
};
const kindLabels: Record<SystemErrorKind, string> = { database: "資料庫", timeout: "逾時", unexpected: "非預期錯誤" };

export default function SystemHealth() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/health", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "無法讀取錯誤紀錄，目前狀態未知。");
        return result as Health;
      })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(() => { if (!controller.signal.aborted) setError("無法讀取錯誤紀錄，目前狀態未知。請稍後重試。"); });
    return () => controller.abort();
  }, [revision]);

  function refresh() { setData(null); setError(""); setRevision(value => value + 1); }

  return <section className="space-y-4 rounded-xl bg-white p-5" aria-labelledby="system-health-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="system-health-title" className="font-bold">System Health · 錯誤紀錄</h2><button onClick={refresh} disabled={!data && !error} className="rounded border px-3 py-2 text-sm disabled:opacity-40">重新整理</button></div>
    <p className="text-sm text-slate-600">目前僅記錄 Admin 統計、會員列表、回報列表與狀態更新的非預期錯誤（含舊回報 API）。不包含 PDF、Quiz、登入、subscription 或全站可用率。</p>
    {error ? <p role="alert" className="text-amber-800">{error}</p> : !data ? <p role="status">讀取錯誤紀錄中…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2"><p>近 24 小時：<strong>{data.last_24_hours}</strong> 筆</p><p>近 7 天：<strong>{data.last_7_days}</strong> 筆</p></div>
      <p className="text-xs text-slate-500">查詢時間：{new Date(data.checked_at).toLocaleString("zh-TW")}</p>
      <h3 className="text-sm font-semibold">近 7 天最近 20 筆</h3>
      {data.errors.length === 0 ? <p className="text-sm text-slate-600">近 7 天尚無已記錄的錯誤。</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">時間</th><th className="p-2">操作</th><th className="p-2">分類</th></tr></thead><tbody>{data.errors.map(entry => {
        const event = Object.hasOwn(systemErrorEvents, entry.event_code) ? systemErrorEvents[entry.event_code as SystemErrorEvent] : null;
        return <tr key={entry.id} className="border-t align-top"><td className="whitespace-nowrap p-2">{new Date(entry.created_at).toLocaleString("zh-TW")}</td><td className="p-2">{event?.label ?? "未識別的操作"}{event && <p className="mt-1 text-xs text-slate-500">{event.method} {event.source}</p>}</td><td className="p-2">{kindLabels[entry.error_kind] ?? "非預期錯誤"}</td></tr>;
      })}</tbody></table></div>}
    </>}
    <p className="text-xs text-slate-500">紀錄從本功能上線後開始累積。資料庫中斷時可能無法寫入；沒有紀錄不代表全站沒有錯誤。</p>
  </section>;
}
