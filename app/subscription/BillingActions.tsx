"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import styles from "./subscription.module.css";

type Action = "checkout" | "cancel" | "resume" | "portal" | "sync";
export default function BillingActions({ enabled, managed = false, canceled = false, canResume = false, expired = false }: {
  enabled: boolean; managed?: boolean; canceled?: boolean; canResume?: boolean; expired?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  async function act(action: Action) {
    if (busy || refreshing) return;
    setBusy(action); setNotice("");
    try {
      const response = await fetch(`/api/billing/${action}`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "操作暫時無法完成，請稍後重試。");
      if (typeof result.url === "string") { window.location.assign(result.url); return; }
      setConfirmCancel(false);
      setNotice("已向付款平台確認，正在更新會員狀態。");
      startTransition(() => router.refresh());
    } catch (error) { setNotice(error instanceof Error ? error.message : "付款服務暫時無法使用。"); }
    finally { setBusy(null); }
  }
  const disabled = !enabled || busy !== null || refreshing;
  return <div className={styles.billingActions} aria-busy={busy !== null || refreshing}>
    {!managed ? <button disabled={disabled} onClick={() => act("checkout")} className={`study-button study-button-primary ${styles.upgrade}`}>
      {busy === "checkout" ? "正在準備安全付款頁…" : !enabled ? "升級 Pro · 即將開放" : expired ? "重新訂閱 Pro" : "升級 VetExam Pro"}
    </button> : <>
      <button disabled={disabled} onClick={() => act("portal")} className="study-button">{busy === "portal" ? "正在開啟…" : "管理／更新付款方式"}</button>
      {!expired && (canceled ? canResume && <button disabled={disabled} onClick={() => act("resume")} className="study-button">{busy === "resume" ? "正在恢復…" : "恢復自動續訂"}</button>
        : <button disabled={disabled} onClick={() => setConfirmCancel(true)} className="study-button">取消自動續訂</button>)}
      <button disabled={disabled} onClick={() => act("sync")} className="study-button">{busy === "sync" || refreshing ? "正在同步…" : "同步付款狀態"}</button>
      {expired && <button disabled={disabled} onClick={() => act("checkout")} className="study-button">重新訂閱 Pro</button>}
    </>}
    {confirmCancel && <div className={styles.notice}>
      <p>取消後，Pro 可使用至目前期間結束，之後不會自動續訂。</p>
      <button disabled={disabled} onClick={() => act("cancel")} className="study-button">{busy === "cancel" ? "正在取消…" : "確認取消自動續訂"}</button>
      <button disabled={disabled} onClick={() => setConfirmCancel(false)} className="study-button">返回</button>
    </div>}
    {notice && <p className={styles.small} role="status">{notice}</p>}
  </div>;
}
