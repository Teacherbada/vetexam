"use client";
import AdminShell, { TableRegion } from "@/components/ui/AdminShell";
import { LoadingState, EmptyState } from "@/components/ui/ContentState";

import { useEffect, useState } from "react";
import SystemHealth from "./SystemHealth";

type Group = { label: string; count: number };
type Data = {
  users: { total: number; today: number; week: number };
  dailyUsers: { date: string; count: number }[];
  banks: { total: number; public: number; private: number };
  questions: { total: number };
  plans: { plan: string; status: string; count: number }[];
  reports: { status: string; count: number }[];
  subjects: Group[];
  years: Group[];
};

function Breakdown({ title, rows }: { title: string; rows: Group[] }) {
  return <section className="rounded-xl bg-white p-5"><h2 className="font-bold">{title}</h2>{rows.length ? <TableRegion label={title}><table className="mt-3 w-full text-left text-sm"><thead><tr><th scope="col" className="py-2">分類</th><th scope="col" className="text-right">數量</th></tr></thead><tbody>{rows.map(row => <tr key={row.label} className="border-t border-slate-100"><td className="py-2">{row.label}</td><td className="text-right">{row.count}</td></tr>)}</tbody></table></TableRegion> : <EmptyState title="尚無資料" />}</section>;
}

export default function AdminDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/dashboard", { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error || "讀取失敗。"); return result; })
      .then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  if (error) return <AdminShell title="VetExam Admin" current="/admin"><p role="alert">{error}</p><button className="mt-4 rounded border p-2" onClick={() => window.location.reload()}>重新載入</button><SystemHealth /></AdminShell>;
  if (!data) return <AdminShell title="VetExam Admin" current="/admin"><LoadingState /></AdminShell>;
  const max = Math.max(1, ...data.dailyUsers.map(day => day.count));
  const x = (index: number) => 5 + index / Math.max(1, data.dailyUsers.length - 1) * 90;
  const y = (count: number) => 100 - count / max * 90;
  const points = data.dailyUsers.map((day, index) => `${x(index)},${y(day.count)}`).join(" ");
  return <AdminShell title="VetExam Admin" current="/admin" description="使用者、題庫與回報概況。">
    <div className="grid gap-3 sm:grid-cols-3"><div className="admin-stat">總使用者<strong>{data.users.total}</strong></div><div className="admin-stat">今日新增<strong>{data.users.today}</strong></div><div className="admin-stat">近 7 日新增<strong>{data.users.week}</strong></div></div>
    <section className="rounded-xl bg-white p-5"><h2 className="font-bold">每日新增使用者（最近 14 天）</h2><div className="overflow-x-auto" role="region" aria-label="每日新增使用者圖表" tabIndex={0}><div className="min-w-[600px]"><svg viewBox="0 0 100 110" preserveAspectRatio="none" role="img" aria-label="最近 14 天每日新增使用者折線圖，詳細數字見下方表格" className="mt-5 h-52 w-full border-b border-l"><polyline points={points} fill="none" stroke="#3f725f" strokeWidth="2" vectorEffect="non-scaling-stroke" />{data.dailyUsers.map((day, index) => <circle key={day.date} cx={x(index)} cy={y(day.count)} r="1.2" fill="#3f725f"><title>{`${day.date}: ${day.count} 人`}</title></circle>)}</svg><div className="mt-2 flex justify-between text-[10px] text-slate-500">{data.dailyUsers.map(day => <span key={day.date}>{day.date}</span>)}</div></div></div><p className="mt-3 text-sm">Y 軸：人數（0–{max}）；X 軸：日期。日期依資料庫時區計算。</p><details className="mt-3 text-sm"><summary className="cursor-pointer">查看每日數字</summary><table className="mt-2"><thead><tr><th scope="col" className="pr-6">日期</th><th scope="col">新增人數</th></tr></thead><tbody>{data.dailyUsers.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.count}</td></tr>)}</tbody></table></details></section>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="admin-stat">總題庫<strong>{data.banks.total}</strong></div><div className="admin-stat">公開<strong>{data.banks.public}</strong></div><div className="admin-stat">私人<strong>{data.banks.private}</strong></div><div className="admin-stat">總題目<strong>{data.questions.total}</strong></div></div>
    <div className="grid gap-4 md:grid-cols-2">
      <Breakdown title="題庫依科目" rows={data.subjects} /><Breakdown title="題庫依年份" rows={data.years} />
      <Breakdown title="Subscription plan／status（訂閱紀錄）" rows={data.plans.map(plan => ({ label: `${plan.plan} / ${plan.status}`, count: plan.count }))} />
      <Breakdown title="回報狀態" rows={data.reports.map(report => ({ label: report.status === "open" ? "待處理" : "已處理", count: report.count }))} />
    </div>
    <SystemHealth />
    <section className="rounded-xl bg-white p-5"><h2 className="font-bold">追蹤狀態</h2><ul className="mt-3 space-y-2 text-sm text-slate-600"><li>Activity（DAU／WAU）：尚未追蹤</li><li>PDF 成功／失敗：尚未追蹤</li><li>System Errors：僅追蹤 Admin 資料 API，見上方錯誤紀錄</li></ul></section>
  </AdminShell>;
}
