"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import { isStudyMode, type StudyMode } from "@/lib/study-plan";
import styles from "./study-plan.module.css";
import Diagnostic from "./diagnostic/Diagnostic";
import Reinforcement from "./reinforcement/Reinforcement";

const options = [
  { mode: "coach", title: "國考教練模式", icon: "target", headline: "不用再想今天該讀什麼。",
    description: "VetExam 會先透過診斷測驗了解你的學習狀況，再根據各科與各章節表現找出目前最需要補強的內容，安排複習與後續測驗。",
    points: ["不知道自己的弱點在哪裡", "不知道接下來應該先讀什麼", "希望系統持續安排學習方向"],
    difference: "你設定目標，VetExam 決定優先讀什麼。", button: "交給 VetExam 安排" },
  { mode: "custom", title: "自訂進度模式", icon: "calendar", headline: "按照自己的節奏準備。",
    description: "自行設定每日題數、完成日期、科目與章節，VetExam 負責安排與追蹤你的學習進度，但不會主動改變你的學習方向。",
    points: ["已經有自己的讀書計畫", "知道目前想加強哪些科目或章節", "希望自己控制刷題範圍"],
    difference: "你決定讀什麼，VetExam 幫忙安排與追蹤。", button: "自己安排進度" },
] as const;

export default function ModeSelector() {
  const [mode, setMode] = useState<StudyMode | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "guest" | "error">("loading");
  const [saving, setSaving] = useState<StudyMode | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/study-plan", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { setMode(null); setState("guest"); return; }
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data.mode !== null && !isStudyMode(data.mode)) throw new Error();
        setMode(data.mode); setState("ready");
      } catch {
        if (!controller.signal.aborted) setState("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

  async function save(next: StudyMode) {
    if (saving || state !== "ready") return;
    setSaving(next); setMessage(""); setError("");
    try {
      const response = await fetch("/api/study-plan", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: next }),
      });
      if (response.status === 401) { setMode(null); setState("guest"); return; }
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!isStudyMode(data.mode)) throw new Error();
      setMode(data.mode); setMessage("學習模式已儲存至你的帳號。");
    } catch { setError("暫時無法確認儲存結果，請重試。原有學習紀錄不受影響。"); }
    finally { setSaving(null); }
  }

  return <>
    <section className={`study-card ${styles.status}`} aria-label="目前學習模式">
      <p role="status">{state === "loading" ? "讀取學習模式中…" : state === "guest" ? "登入後即可儲存你的學習模式。" : state === "error" ? "學習模式暫時無法讀取。" : mode ? `目前模式：${options.find(option => option.mode === mode)?.title}` : "先選擇你的學習模式"}</p>
      {state === "guest" && <Link href="/login" className="study-button">登入帳號</Link>}
      {state === "error" && <button className="study-button" onClick={() => { setState("loading"); setReload(value => value + 1); }}>重新載入</button>}
      <p className="study-muted">國考教練已開放診斷、弱點確認與補強驗證；自訂進度設定將陸續開放。你也可以繼續使用國考題庫練習。</p>
    </section>
    {state === "ready" && mode === "coach" && <><Reinforcement preview /><Diagnostic preview /></>}
    <div className={styles.grid} aria-busy={saving !== null}>
      {options.map(option => <section key={option.mode} className={`study-card ${styles.card}`} data-selected={mode === option.mode}>
        <h2><StudyIcon name={option.icon} />{option.title}</h2>
        <p className={styles.headline}>{option.headline}</p>
        <p>{option.description}</p>
        <p className={styles.difference}>{option.difference}</p>
        <h3>適合這樣的你</h3>
        <ul>{option.points.map(point => <li key={point}>{point}</li>)}</ul>
        <button type="button" className={`study-button ${mode === option.mode ? "" : "study-button-primary"}`} disabled={state !== "ready" || saving !== null || mode === option.mode} aria-pressed={mode === option.mode} onClick={() => void save(option.mode)}>
          {saving === option.mode ? "儲存中…" : mode === option.mode ? "目前使用中" : option.button}
        </button>
      </section>)}
    </div>
    <p role="status">{message}</p>
    {error && <p role="alert">{error}</p>}
    <p className="study-muted">隨時可以切換模式。切換後會保留作答紀錄、錯題、收藏、既有分析與學習進度。</p>
    <Link href="/subjects" className="study-text-link">前往國考題庫練習<StudyIcon name="arrow" /></Link>
  </>;
}
