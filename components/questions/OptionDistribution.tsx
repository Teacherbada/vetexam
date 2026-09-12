"use client";

import { useEffect, useState } from "react";
import { mostMistaken, type OptionDistributionData } from "@/lib/option-distribution";
import { waitForAnswerStatistics } from "@/lib/answer-statistics-client";
import styles from "./option-distribution.module.css";

type Props = { questionId: number; selectedAnswer: string; correctAnswer: string; expanded?: boolean };

function Distribution({ questionId, selectedAnswer, correctAnswer }: Props) {
  const [data, setData] = useState<OptionDistributionData | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        // Let this answer's write settle, without holding up the quiz itself.
        // Long exam batches must not keep the secondary panel waiting indefinitely.
        await Promise.race([waitForAnswerStatistics(questionId), new Promise((resolve) => setTimeout(resolve, 1500))]);
        if (controller.signal.aborted) return;
        const response = await fetch(`/api/stats/option-distribution?questionId=${questionId}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error("Distribution unavailable");
        const result: OptionDistributionData = await response.json();
        if (!controller.signal.aborted) setData(result);
      } catch { if (!controller.signal.aborted) setError(true); }
    }
    void load();
    return () => controller.abort();
  }, [questionId, retry]);

  if (error) return <div className={styles.content} role="status"><p>暫時無法取得作答分布。</p><button className={styles.retry} onClick={() => { setError(false); setRetry((value) => value + 1); }}>重新載入</button></div>;
  if (!data) return <p className={styles.content} role="status">正在整理作答分布…</p>;
  if (!data.sufficient) return <p className={styles.content} role="status">選項統計資料正在累積中。<small>累積 {data.min_attempts} 次有效選項紀錄後顯示。</small></p>;
  const mistaken = mostMistaken(data.options, correctAnswer);
  return <div className={styles.content}>
    <p className={styles.caption}>依 {data.total} 次有效首次作答選項紀錄統計；不含未記錄選項的舊作答。</p>
    <div className={styles.rows}>{data.options.map((option) => <div key={option.letter} className={styles.row}>
      <div className={styles.label}><strong>{option.letter}</strong><span className={styles.badges}>{option.letter === selectedAnswer.toUpperCase() && <span>你的答案</span>}{option.letter === correctAnswer.trim().toUpperCase() && <span className={styles.correct}>正確答案</span>}</span><span className={styles.percentage}>{option.percentage}%</span></div>
      <div className={styles.track} role="progressbar" aria-label={`選項 ${option.letter} 作答比例`} aria-valuenow={option.percentage} aria-valuemin={0} aria-valuemax={100}><span className={option.letter === correctAnswer.trim().toUpperCase() ? styles.correctBar : undefined} style={{ width: `${option.percentage}%` }} /></div>
    </div>)}</div>
    {mistaken.length > 0 ? <p className={styles.insight}><strong>最常誤選：{mistaken.map((option) => option.letter).join("、")}</strong><span>{mistaken.length > 1 ? `各有 ${mistaken[0].percentage}% 的有效作答者選擇，並列最常誤選。` : `${mistaken[0].percentage}% 的有效作答者選擇 ${mistaken[0].letter}。`}</span></p>
      : data.options.some((option) => option.letter === correctAnswer.trim().toUpperCase()) && <p className={styles.caption}>目前有效選項紀錄皆為正確答案。</p>}
  </div>;
}

// Parents only mount this component after an answer or after exam submission.
export default function OptionDistribution(props: Props) {
  const [open, setOpen] = useState(props.expanded ?? false);
  return <details className={styles.panel} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>大家都選了什麼？<span>有效作答選項分布</span></summary>
    {open && <Distribution key={props.questionId} {...props} />}
  </details>;
}
