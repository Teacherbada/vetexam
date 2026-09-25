"use client";
import AdminShell, { TableRegion } from "@/components/ui/AdminShell";
import { LoadingState, EmptyState } from "@/components/ui/ContentState";

import { useEffect, useState } from "react";

type User = { id: string; name: string; email: string; created_at: string; plan: string | null; status: string | null; expires_at: string | null; effective_plan: string; bank_count: number };
type Data = { users: User[]; total: number; pageSize: number };

export default function Users() {
  const [email, setEmail] = useState("");
  const [filters, setFilters] = useState({ email: "", plan: "all", page: 1 });
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/users?${new URLSearchParams({ ...filters, page: String(filters.page) })}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "讀取失敗。"); return result; })
      .then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [filters]);
  function change(next: typeof filters) { setData(null); setError(""); setFilters(next); }
  return <AdminShell title="Users 會員管理" current="/admin/users">
    <form className="flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); change({ ...filters, email: email.trim(), page: 1 }); }}>
      <label>搜尋 email<input aria-label="搜尋 email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="搜尋 email" className="rounded border bg-white p-2" /></label>
      <label>會員方案<select aria-label="會員方案" value={filters.plan} onChange={event => change({ ...filters, plan: event.target.value, page: 1 })} className="rounded border bg-white p-2"><option value="all">全部會員</option><option value="free">Free</option><option value="pro">PRO</option></select></label>
      <button className="rounded bg-blue-700 px-4 py-2 text-white">搜尋</button>
    </form>
    <p className="text-sm text-slate-600">PRO：訂閱為 pro／active 且尚未到期；其餘歸為 Free。會員資料僅供檢視。</p>
    {error ? <div role="alert">{error}<button className="study-button ml-3" onClick={() => change({ ...filters })}>重試</button></div> : !data ? <LoadingState /> : <>
      <p>共 {data.total} 位會員</p>
      <TableRegion label="會員資料表"><table className="w-full text-left text-sm"><thead><tr>{["Email", "註冊時間", "有效方案", "Subscription", "題庫數", "詳情"].map(label => <th scope="col" key={label} className="p-3">{label}</th>)}</tr></thead><tbody>
        {data.users.map(user => <tr key={user.id} className="border-t align-top"><td className="p-3 break-all">{user.email}</td><td className="p-3">{new Date(user.created_at).toLocaleString("zh-TW")}</td><td className="p-3"><span className="admin-status">{user.effective_plan === "pro" ? "PRO" : "Free"}</span></td><td className="p-3">{user.plan ? `${user.plan} / ${user.status}` : "無訂閱紀錄"}</td><td className="p-3">{user.bank_count}</td><td className="p-3"><details><summary className="cursor-pointer">檢視</summary><dl className="mt-2 space-y-2 break-all"><dt>會員 ID</dt><dd>{user.id}</dd><dt>姓名</dt><dd>{user.name || "未提供"}</dd><dt>訂閱到期</dt><dd>{user.expires_at ? new Date(user.expires_at).toLocaleString("zh-TW") : "未設定"}</dd></dl></details></td></tr>)}
      </tbody></table>{data.users.length === 0 && <EmptyState title="沒有符合條件的會員。" description="試著調整 email 或會員方案。" />}</TableRegion>
      <div className="flex items-center gap-4"><button disabled={filters.page <= 1} className="rounded border p-2 disabled:opacity-40" onClick={() => change({ ...filters, page: filters.page - 1 })}>上一頁</button><span>第 {filters.page} 頁／共 {Math.max(1, Math.ceil(data.total / data.pageSize))} 頁</span><button disabled={filters.page * data.pageSize >= data.total} className="rounded border p-2 disabled:opacity-40" onClick={() => change({ ...filters, page: filters.page + 1 })}>下一頁</button></div>
    </>}
  </AdminShell>;
}
