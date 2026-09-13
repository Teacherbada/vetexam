"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ProgressBar } from "@/components/dashboard/StudyUI";
import { REINFORCEMENT_LABELS, REINFORCEMENT_VERIFICATION_QUESTION_COUNT, type ReinforcementCommand, type ReinforcementView } from "@/lib/reinforcement";
import { WEAKNESS_LABELS } from "@/lib/weakness";
import styles from "../diagnostic/diagnostic.module.css";
import quiz from "@/app/questions/quiz.module.css";

export default function Reinforcement({ preview = false }: { preview?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<ReinforcementView | null>(null);
  const [error, setError] = useState("");
  const [guest, setGuest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState("");
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const endpoint = "/api/study-plan/reinforcement";
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { if (!controller.signal.aborted) setGuest(true); return; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) { setData(body); setGuest(false); setSelected(""); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "補強進度暫時無法載入。"); }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

  async function send(action: "start" | "answer" | ReinforcementCommand['action']) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const body = action === "answer" ? { taskId: data?.task?.id, sessionId: data?.session?.id, position: data?.session?.current?.position, answer: selected }
        : { action, taskId: data?.task?.id, reviewAttempt: data?.task?.review_count };
      const response = await fetch(endpoint, action === "start" ? { method: "POST" } : {
        method: action === "answer" ? "PUT" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (response.status === 401) { setGuest(true); setData(null); return; }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result); setSelected("");
      if (preview && action === "start") router.push("/study-plan/reinforcement");
      else requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "無法確認儲存結果，請重新載入。"); }
    finally { locked.current = false; setBusy(false); }
  }
  const refresh = <button className="study-button" disabled={busy} onClick={() => { setData(null); setError(""); setReload(value => value + 1); }}>重新載入補強進度</button>;
  if (guest) return <section className={`study-card ${styles.stack}`}><h2>請先登入</h2><p>補強與確認測驗進度會儲存至你的帳號。</p><Link href="/login" className="study-button">登入帳號</Link></section>;
  if (!data) return <section className={`study-card ${styles.stack}`}>{error ? <><p role="alert">{error}</p>{refresh}</> : <p role="status">讀取補強進度中…</p>}</section>;
  if (data.mode !== "coach") return <section className={`study-card ${styles.stack}`}><h2>先選擇國考教練模式</h2><p>切回國考教練後可繼續原有補強任務。</p><Link href="/study-plan" className="study-button">設定學習模式</Link></section>;
  const task = data.task;
  const session = data.session;
  const current = session?.current;
  const attempt = data.attempts.find(row => row.attempt === task?.review_count);
  const button = (action: Parameters<typeof send>[0], label: string, primary = true) => <button className={`study-button ${primary ? "study-button-primary" : ""}`} disabled={busy} onClick={() => void send(action)}>{busy ? "儲存中…" : label}</button>;
  return <div className={styles.stack} aria-busy={busy}>
    {error && <section className={`study-card ${styles.stack}`}><p role="alert">{error}</p>{refresh}</section>}
    <section className={`study-card ${styles.stack}`}>
      <h2 ref={heading} tabIndex={-1}>{task ? "目前補強任務" : "建議下一步"}</h2>
      {task ? <>
        <h3>{task.subject} → {task.chapter}</h3>
        <p role="status">{REINFORCEMENT_LABELS[task.status]}</p>
        <p>補強前有效樣本：{task.source_analysis.correct} / {task.source_analysis.count} 題正確（{Math.round((task.source_analysis.accuracy ?? 0) * 100)}%） · {WEAKNESS_LABELS[task.source_analysis.status]}</p>
        <p className="study-muted">你在這些有效樣本中的表現較不穩定，因此建議先複習這個章節。補強前分析會保留，確認結果另外記錄。</p>
        {preview && task.status !== "short_term" && <Link href="/study-plan/reinforcement" className="study-button study-button-primary">{task.status === "reviewed" ? "開始確認" : task.status === "verifying" ? "繼續確認測驗" : task.status === "needs_work" ? "再次複習" : "繼續你的補強任務"}</Link>}
        {!preview && task.status === "reviewing" && <>
          <h3>自行複習 · 第 {task.review_count} 次</h3>
          <p>請使用你平常的課本、講義或其他可信學習資料完成複習。未來 VetExam 將在此加入相關重點筆記與學習內容。</p>
          <p className="study-muted">完成複習後還需要確認測驗，才會評估是否達到短期掌握。</p>
          {button("review", "我已完成複習")}
        </>}
        {!preview && task.status === "reviewed" && <>
          <h3>用幾題確認一下</h3><p>優先使用同一章節的其他題目，確認剛才複習的內容。預計最多 {REINFORCEMENT_VERIFICATION_QUESTION_COUNT} 題；題庫不足時會使用較少題目或先前做過的題目並標示。</p>
          {button("verify", "開始確認")}
        </>}
        {task.status === "short_term" && <><h3>目前已達短期掌握</h3><p>你在剛完成複習後的確認測驗表現良好。這代表本次短期表現；後續間隔追蹤功能尚未開放。</p></>}
        {task.status === "needs_work" && <><h3>建議再複習一次</h3><p>{attempt && attempt.total < attempt.minQuestions ? "本次題目數不足以判定短期掌握，請持續複習，待題庫補充後再確認。" : "這個章節目前仍有部分觀念不穩定，建議再次複習後再進行確認。"}</p>{!preview && button("again", "再次複習")}</>}
        {!preview && task.status === "deferred" && <><p>稍後複習的任務已保留，尚未完成補強。</p>{button("resume", "繼續補強")}</>}
        {!preview && !["short_term", "deferred"].includes(task.status) && button("defer", "稍後再複習", false)}
      </> : !data.next && <><p>目前沒有足夠證據推薦新的章節補強。先完成初始診斷與弱點確認，累積不同題目的章節資料。</p><Link href="/study-plan/diagnostic" className="study-button">查看診斷進度</Link><Link href="/study-plan/confirmation" className="study-button">前往弱點確認</Link></>}
      {(!task || task.status === "short_term") && data.next && <><h3>建議下一步：{data.next.subject} → {data.next.chapter}</h3><p>先複習這個章節，再用幾題確認是否理解。</p>{button("start", task ? "繼續下一個任務" : "開始補強")}</>}
      <Link href="/subjects" className="study-text-link">繼續一般練習</Link>
    </section>
    {!preview && task && <section className={`study-card ${styles.stack}`}><h2>相關學習內容</h2><p className="study-muted">相關 VetExam 筆記功能準備中。</p></section>}
    {!preview && task?.status === "verifying" && session && current && <section className={`study-card ${styles.stack}`}>
      <h2>補強確認測驗</h2><p role="status">已儲存 {session.answered} / {session.total} 題</p>
      <ProgressBar value={session.total ? session.answered / session.total * 100 : 0} label="補強確認完成百分比" />
      {attempt && <p className="study-muted">本次共 {session.total} 題，含 {attempt.repeatedCount} 題先前出現或作答過的題目。至少 {attempt.minQuestions} 題且正確率達 {Math.round(attempt.passThreshold * 100)}% 才判定短期掌握。</p>}
      <p className="study-muted">第 {current.position} 題 · {current.subject} · {current.chapter}</p><h3 className={quiz.question}>{current.question}</h3>
      {current.image && <img className={styles.image} src={current.image} alt="本題附圖" /> /* eslint-disable-line @next/next/no-img-element */}
      <div className={quiz.options} role="group" aria-label="補強確認答案選項">{current.options.map((option, index) => {
        if (!option.trim()) return null;
        const letter = String.fromCharCode(65 + index);
        return <button key={`${current.position}-${letter}`} className={`${quiz.option} ${selected === letter ? quiz.selected : ""}`} aria-pressed={selected === letter} disabled={busy} onClick={() => setSelected(letter)}><span className={quiz.letter}>{letter}</span><span className={quiz.optionText}>{option}</span></button>;
      })}</div>
      <p className="study-muted">按送出後鎖定答案並儲存，可隨時離開後繼續。</p>
      <button className="study-button study-button-primary" disabled={busy || !selected} onClick={() => void send("answer")}>{busy ? "儲存中…" : session.answered + 1 === session.total ? "送出並完成確認" : "送出並繼續"}</button>
    </section>}
    {attempt?.completedAt && <section className={`study-card ${styles.stack}`}><h2>補強確認完成</h2><p>{attempt.correct} / {attempt.total} 正確（{Math.round(attempt.correct / attempt.total * 100)}%）</p><p className="study-muted">含 {attempt.repeatedCount} 題重複題；通過條件為至少 {attempt.minQuestions} 題、正確率 {Math.round(attempt.passThreshold * 100)}%。</p></section>}
    {!preview && data.attempts.length > 0 && <section className={`study-card ${styles.stack}`}><h2>本章節複習與確認紀錄</h2><ul>{data.attempts.map(row => <li key={row.id}>第 {row.attempt} 次複習後確認：{row.completedAt ? `${row.correct} / ${row.total} 正確（${Math.round(row.correct / row.total * 100)}%），${new Date(row.completedAt).toLocaleString("zh-TW")}` : `已儲存 ${row.answered} / ${row.total} 題`}；重複 {row.repeatedCount} 題</li>)}</ul></section>}
    {data.completed.length > 0 && <section className={`study-card ${styles.stack}`}><h2>已達短期掌握的章節</h2><ul>{data.completed.map(row => <li key={`${row.subject}/${row.chapter}`}>{row.subject} → {row.chapter}：補強前 {row.baseline === null ? "資料不足" : `${Math.round(row.baseline * 100)}%`} → 補強確認 {row.correct} / {row.total}（{Math.round(row.correct / row.total * 100)}%）；目前狀態：短期掌握</li>)}</ul></section>}
  </div>;
}
