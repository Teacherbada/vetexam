"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ProgressBar, StudyIcon } from "@/components/dashboard/StudyUI";
import { DIAGNOSTIC_CONFIG, type DiagnosticView } from "@/lib/diagnostic";
import quiz from "@/app/questions/quiz.module.css";
import styles from "./diagnostic.module.css";

const endpoint = "/api/study-plan/diagnostic";
export default function Diagnostic({ preview = false }: { preview?: boolean }) {
  const [data, setData] = useState<DiagnosticView | null>(null);
  const [error, setError] = useState("");
  const [guest, setGuest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState("");
  const locked = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setGuest(true); setData(null); return; }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (!controller.signal.aborted) { setData(body); setGuest(false); setSelected(""); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "診斷暫時無法載入。");
      }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

  async function send(action: "start" | "answer") {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, action === "start" ? { method: "POST" } : {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          sessionId: data?.session?.id, position: data?.session?.current?.position, answer: selected,
        }),
      });
      if (response.status === 401) { setGuest(true); setData(null); return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body); setSelected("");
      requestAnimationFrame(() => heading.current?.focus());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "無法確認儲存結果，請重新載入診斷。"); }
    finally { locked.current = false; setBusy(false); }
  }

  const session = data?.session;
  const current = session?.current;
  const reloadButton = <button className="study-button" disabled={busy} onClick={() => { setData(null); setError(""); setReload(value => value + 1); }}>重新載入診斷</button>;
  if (guest) return <section className={`study-card ${styles.stack}`}><h2>請先登入</h2><p>診斷進度會儲存至你的帳號，方便下次繼續。</p><Link href="/login" className="study-button">登入帳號</Link></section>;
  if (!data) return <section className={`study-card ${styles.stack}`}>{error ? <><p role="alert">{error}</p>{reloadButton}</> : <p role="status">讀取診斷進度中…</p>}</section>;
  if (data.mode !== "coach") return <section className={`study-card ${styles.stack}`}><h2>先選擇國考教練模式</h2><p>既有診斷進度會保留，切回國考教練後可以繼續。</p><Link href="/study-plan" className="study-button">設定學習模式</Link></section>;

  return <div className={styles.stack} aria-busy={busy}>
    {error && <div className={`study-card ${styles.stack}`}><p role="alert">{error}</p>{reloadButton}</div>}
    {!session ? <section className={`study-card ${styles.stack}`}>
      <h2 ref={heading} tabIndex={-1}>先讓 VetExam 了解你</h2>
      <p>在開始安排個人化學習計畫前，我們會先透過一份診斷測驗了解你目前六科的學習狀況。</p>
      <p>這不是正式考試，目的是幫助我們找出之後值得優先確認的科目與章節。</p>
      <p className="study-muted">每科預計 {DIAGNOSTIC_CONFIG.questionsPerSubject} 題；題量不足時會使用實際可用題目並標示缺口。每題送出後會儲存，可隨時離開後續作。</p>
      {preview ? <Link href="/study-plan/diagnostic" className="study-button study-button-primary">開始診斷<StudyIcon name="arrow" /></Link>
        : <button className="study-button study-button-primary" disabled={busy} onClick={() => void send("start")}>{busy ? "準備題目中…" : "開始診斷"}</button>}
    </section> : <>
      <section className={`study-card ${styles.stack}`}>
        <h2 ref={heading} tabIndex={-1}>{session.completed ? "初步診斷完成" : "診斷進度"}</h2>
        <p role="status">已儲存 {session.answered} / {session.total} 題</p>
        <ProgressBar value={session.total ? session.answered / session.total * 100 : 0} label="診斷完成百分比" />
        {session.shortages.length > 0 && <div className={styles.shortages}><p>部分科目題量不足，本次依實際可用題目進行；缺題科目不視為零分，也不判定弱科。</p><ul>{session.shortages.map(row => <li key={row.subject}>{row.subject}：{row.available} / {DIAGNOSTIC_CONFIG.questionsPerSubject} 題</li>)}</ul></div>}
        {preview && <Link href="/study-plan/diagnostic" className="study-button study-button-primary">{session.completed ? "查看初步結果" : "繼續診斷"}<StudyIcon name="arrow" /></Link>}
      </section>
      {!preview && !session.completed && current && <section className={`study-card ${styles.stack}`}>
        <p className="study-muted">第 {current.position} 題 · {current.subject}{current.chapter ? ` · ${current.chapter}` : ""}</p>
        <h2 className={quiz.question}>{current.question}</h2>
        {/* Preserve source images; no remote image optimization or HTML injection. */}
        {current.image && <img className={styles.image} src={current.image} alt="本題附圖" /> /* eslint-disable-line @next/next/no-img-element */}
        <div className={quiz.options} role="group" aria-label="診斷答案選項">{current.options.map((option, index) => {
          if (!option.trim()) return null;
          const letter = String.fromCharCode(65 + index);
          return <button key={`${current.position}-${letter}`} className={`${quiz.option} ${selected === letter ? quiz.selected : ""}`} aria-pressed={selected === letter} disabled={busy} onClick={() => setSelected(letter)}><span className={quiz.letter}>{letter}</span><span className={quiz.optionText}>{option}</span></button>;
        })}</div>
        <p className="study-muted">選擇後按送出即鎖定答案。請等待「已儲存」題數更新；初步結果會在完成後顯示。</p>
        <button className="study-button study-button-primary" disabled={busy || !selected} onClick={() => void send("answer")}>{busy ? "儲存中…" : session.answered + 1 === session.total ? "送出並完成診斷" : "送出並繼續"}</button>
      </section>}
      {!preview && session.completed && <section className={`study-card ${styles.stack}`}>
        <h2>各科初步表現</h2>
        <div className={styles.results}>{session.results.map(row => <div key={row.subject}><h3>{row.subject}</h3><p>{row.total ? `${row.correct} / ${row.total}` : "尚無可用題目"}</p><p className="study-muted">{row.insufficient ? "資料不足，暫不判定" : row.suspect ? "目前可能需要進一步確認" : "本次未列為優先確認科目"}</p></div>)}</div>
        <p>這只是初步診斷。VetExam 接下來會針對目前表現較弱的科目進一步確認，避免因題目數不足而誤判。</p>
        <button className="study-button" disabled aria-describedby="confirmation-coming">繼續弱點確認</button>
        <p id="confirmation-coming" className="study-muted">弱點確認將於下一階段開放；本次結果已儲存，目前尚未判定章節弱點。</p>
        <Link href="/subjects" className="study-text-link">先繼續一般練習<StudyIcon name="arrow" /></Link>
      </section>}
    </>}
  </div>;
}
