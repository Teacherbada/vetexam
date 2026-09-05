"use client";

import Link from "next/link";
import { useSyncExternalStore, type CSSProperties } from "react";
import { StudyIcon } from "@/components/dashboard/StudyUI";
import { buildAnalysis, getMasteryStatus, MIN_SAMPLE_SIZE, practiceHref } from "./analytics";
import styles from "./analysis.module.css";

function subscribe(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === "progress" || event.key === null) onChange();
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onChange);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("focus", onChange); };
}
function getSnapshot() {
  try { return localStorage.getItem("progress") ?? "{}"; }
  catch { return "storage-unavailable"; }
}
function getServerSnapshot() { return null; }
function percentage(value: number | null) { return value === null ? "—" : `${Math.round(value)}%`; }
function MasteryRing({ accuracy, color = "#5F8F7B", label }: { accuracy: number | null; color?: string; label: string }) {
  return <div className={styles.ring} role="img" aria-label={`${label}：${accuracy === null ? "尚無答題紀錄" : `正確率 ${percentage(accuracy)}`}`}>
    <svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="66" fill="none" stroke="#EDF0ED" strokeWidth="9" /><circle cx="80" cy="80" r="66" fill="none" stroke={color} strokeWidth="9" pathLength="100" strokeDasharray={`${accuracy ?? 0} 100`} strokeLinecap={accuracy ? "round" : "butt"} transform="rotate(-90 80 80)" /></svg>
    <span aria-hidden="true"><strong>{percentage(accuracy)}</strong><small>{accuracy === null ? "尚未作答" : "目前掌握度"}</small></span>
  </div>;
}

export default function AnalysisPage() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const analysis = buildAnalysis(raw ?? "{}");
  const weakest = analysis.ranking[0];
  const loading = raw === null;

  return <main className={styles.page}>
    <div className={styles.container}>
      <nav className={styles.breadcrumb} aria-label="麵包屑"><Link href="/"><StudyIcon name="home" />首頁</Link><span aria-hidden="true">/</span><span aria-current="page">弱點分析</span></nav>
      <header className={styles.header}><div><p className={styles.eyebrow}>每一次練習，都更了解自己</p><h1>弱點分析</h1><p>找出目前最需要加強的科目，讓每一次刷題更有效率。</p></div><span className={styles.scope}><StudyIcon name="chart" />本裝置・全部紀錄</span></header>
      {loading ? <section className={styles.empty} aria-busy="true" role="status">正在整理你的學習紀錄…</section> : <>
        {analysis.hasInvalidRecords && <p className={styles.notice} role="status">部分本機紀錄無法讀取，以下僅統計可用資料。原有紀錄未變更；你可以重新整理頁面再試一次。</p>}
        {analysis.answered === 0 ? <section className={styles.empty}><span className={styles.emptyIcon}><StudyIcon name="leaf" /></span><h2>{analysis.hasInvalidRecords ? "暫時無法顯示分析" : "還沒有足夠資料"}</h2><p>完成一些題目後，VetExam 會開始分析你的各科表現。<br />每科累積至少 {MIN_SAMPLE_SIZE} 題，就能開始比較練習方向。</p><Link className="study-button study-button-primary" href="/subjects">開始刷題 <StudyIcon name="arrow" /></Link></section> : <>
          <section className={styles.overall} aria-labelledby="overall-title"><div className={styles.overallRing}><MasteryRing accuracy={analysis.accuracy} label="整體掌握度" /></div><div className={styles.overallContent}><p className={styles.eyebrow}>一題一題，看見累積</p><h2 id="overall-title">你的整體掌握度</h2><p className={styles.description}>以累積答題正確率，了解目前的練習表現。</p><dl className={styles.totals}><div><dt>已作答</dt><dd>{analysis.answered.toLocaleString()}<small>題</small></dd></div><div><dt>答對</dt><dd>{analysis.correct.toLocaleString()}<small>題</small></dd></div><div><dt>錯題</dt><dd>{analysis.wrong.toLocaleString()}<small>題</small></dd></div></dl></div><div className={styles.nextStep}><span className={styles.smallLabel}><StudyIcon name="target" />下一步練習方向</span>{weakest ? <><h3>{weakest.subject}</h3><p>目前符合樣本門檻的科目中，正確率最低。</p><a href="#recommendation" className={styles.textLink}>查看練習建議 <StudyIcon name="arrow" /></a></> : <><h3>先累積一科的答題紀錄</h3><p>每科至少 {MIN_SAMPLE_SIZE} 題，再一起找出值得加強的方向。</p><Link href="/subjects" className={styles.textLink}>選擇科目 <StudyIcon name="arrow" /></Link></>}</div></section>
          <section className={styles.subjectSection} aria-labelledby="subjects-title"><div className={styles.sectionHeader}><h2 id="subjects-title">各科掌握度</h2><p>顏色代表科目，文字呈現學習狀態</p></div><div className={styles.subjectGrid}>{analysis.subjects.map((record) => <article className={styles.subjectCard} key={record.subject} style={{ "--subject-color": record.color.main, "--subject-light": record.color.light } as CSSProperties}><MasteryRing accuracy={record.accuracy} color={record.color.main} label={record.subject} /><h3>{record.subject}</h3><span className={styles.status}>{getMasteryStatus(record.accuracy, record.answered)}</span><p>已作答 <strong>{record.answered.toLocaleString()}</strong> 題</p><small>答對 {record.correct} 題 · 錯題 {record.wrong} 題</small>{record.answered > 0 && record.answered < MIN_SAMPLE_SIZE && <small className={styles.sampleNote}>再累積 {MIN_SAMPLE_SIZE - record.answered} 題，即可納入比較</small>}</article>)}</div></section>
          <div className={styles.bottomGrid}><section className={styles.ranking} aria-labelledby="ranking-title"><div className={styles.sectionHeader}><h2 id="ranking-title">最需要加強</h2><span>正確率低 → 高</span></div><p className={styles.description}>只比較已作答至少 {MIN_SAMPLE_SIZE} 題的科目。</p>{analysis.ranking.length ? <ol>{analysis.ranking.map((record, index) => <li key={record.subject}><span className={styles.rankNumber}>{String(index + 1).padStart(2, "0")}</span><div className={styles.rankContent}><div><h3>{record.subject}</h3><strong>{percentage(record.accuracy)}</strong></div><div className={styles.bar} aria-hidden="true"><span style={{ width: `${record.accuracy}%`, background: record.color.main }} /></div><p>{getMasteryStatus(record.accuracy, record.answered)} · 已作答 {record.answered} 題</p></div></li>)}</ol> : <div className={styles.rankingEmpty}><StudyIcon name="book" /><p>先累積一些練習，再開始比較。<br />目前各科的答題樣本還不足。</p></div>}</section>
          <section className={styles.recommendation} id="recommendation" aria-labelledby="recommendation-title"><span className={styles.recommendIcon}><StudyIcon name="leaf" /></span><p className={styles.eyebrow}>讓下一次練習更有方向</p><h2 id="recommendation-title">建議優先複習</h2>{weakest ? <><h3>{weakest.subject}</h3><p>{weakest.accuracy! >= 80 ? "目前各科表現都不錯，可以從相對較低的科目持續鞏固。" : "今天先從這一科開始，一次專心練習一點點。"}</p><dl className={styles.recommendStats}><div><dt>目前掌握度</dt><dd>{percentage(weakest.accuracy)}</dd></div><div><dt>已完成</dt><dd>{weakest.answered}<small>題</small></dd></div><div><dt>答對</dt><dd>{weakest.correct}<small>題</small></dd></div></dl><Link className="study-button study-button-primary" href={practiceHref(weakest.subject)}>{practiceHref(weakest.subject) === "/subjects" ? "選擇練習題庫" : "開始加強練習"}<StudyIcon name="arrow" /></Link><small className={styles.ctaNote}>{practiceHref(weakest.subject) === "/subjects" ? "此歷史科目請至現有題庫選擇練習。" : `${weakest.subject} · 隨機 20 題`}</small></> : <><h3>從你想練習的科目開始</h3><p>資料不足時，先不判定最弱科目。累積更多答題紀錄後，再提供科目建議。</p><Link href="/subjects" className="study-button study-button-primary">選擇科目開始練習 <StudyIcon name="arrow" /></Link></>}</section></div>
        </>}
        <aside className={styles.method}><StudyIcon name="book" /><div><h2>關於這份分析</h2><p>掌握度以「答對題數 ÷ 已作答題數」計算，僅供練習參考。依現有紀錄規則，同一科目的同一題只計入首次作答；重做不會更新這份累積正確率。</p><p>紀錄保存在目前瀏覽器，未依帳號分開。目前沒有答題時間資料，因此不顯示近期趨勢或時間篩選。</p></div></aside>
      </>}
    </div>
  </main>;
}
