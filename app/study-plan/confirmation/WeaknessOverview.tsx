import { WEAKNESS_CONFIG, WEAKNESS_LABELS, type Performance, type WeaknessAnalysis } from "@/lib/weakness";
import styles from "./weakness.module.css";

function score(row: Performance) {
  return row.accuracy === null ? "尚無作答資料" : `${row.correct} / ${row.count} 題 · ${Math.round(row.accuracy * 100)}%`;
}
export default function WeaknessOverview({ analysis }: { analysis: WeaknessAnalysis }) {
  const hasChapterEvidence = analysis.subjects.some(subject => subject.chapters.some(chapter => chapter.status !== "insufficient"));
  return <>
    <section className={`study-card ${styles.section}`}>
      <h2>目前建議優先補強</h2>
      {analysis.priorities.length ? <ol className={styles.priorities}>{analysis.priorities.map(row => <li key={`${row.subject}/${row.chapter}`}>
        <h3>{row.subject} → {row.chapter}</h3><p>{WEAKNESS_LABELS[row.status]} · {score(row)}</p>
        <p className="study-muted">近期 {row.recentCount} 題中有 {row.distinctErrors} 道不同題目答錯，建議先複習這個章節。</p>
      </li>)}</ol> : <p>{hasChapterEvidence ? "目前有足夠資料的章節尚未列出優先補強項目；其他章節仍依各自的資料狀態評估。" : "目前沒有足夠證據列出章節補強建議。請參考各科資料狀態，完成更多不同題目的確認後再評估。"}</p>}
      <p className="study-muted">這是依目前作答整理的建議，不代表已精通或長期掌握。補強任務與後續追蹤會在下一階段提供。</p>
    </section>
    <section className={`study-card ${styles.section}`}>
      <h2>科目與章節分析</h2>
      <p>依最近 {analysis.lookbackDays} 天的不同題目與近期表現評估；同題重做不增加樣本數。</p>
      <p className="study-muted">科目至少 {WEAKNESS_CONFIG.minSubjectQuestions} 題；章節至少 {WEAKNESS_CONFIG.minChapterQuestions} 題，其中至少 {WEAKNESS_CONFIG.minConfirmationQuestions} 題需來自已完成的弱點確認。未達門檻只顯示資料不足。</p>
      <div className={styles.subjects}>{analysis.subjects.map(subject => <details key={subject.subject} className={styles.subject}>
        <summary><span><strong>{subject.subject}</strong><span>{score(subject)}</span></span><span>{WEAKNESS_LABELS[subject.status]}</span></summary>
        <p className="study-muted">其中 {subject.unclassified} 題尚無正式章節分類，僅計入科目表現。近期正確率：{subject.recentAccuracy === null ? "資料不足" : `${Math.round(subject.recentAccuracy * 100)}%（${subject.recentCount} 題）`}。</p>
        <ul className={styles.chapters}>{subject.chapters.map(chapter => <li key={chapter.chapter}>
          <div><strong>{chapter.chapter}</strong><span>{WEAKNESS_LABELS[chapter.status]}</span></div>
          <p>{score(chapter)} · 確認題目 {chapter.confirmationCount} 題</p>
          {chapter.status === "insufficient" && <p className="study-muted">需要更多不同題目的確認，暫不判定章節弱點。</p>}
        </li>)}</ul>
      </details>)}</div>
    </section>
  </>;
}
