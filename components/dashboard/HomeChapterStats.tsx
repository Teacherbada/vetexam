"use client";

import Link from "next/link";
import { LoadingState } from "@/components/ui/ContentState";
import { useState } from "react";
import { chapterGroups, EXAM_SUBJECTS } from "@/data/exam-chapters";
import { StudyIcon } from "./StudyUI";
import type { ChapterCount } from "./useHomeAvailability";

export default function HomeChapterStats({ rows, error, retry }: { rows: ChapterCount[] | null; error: boolean; retry: () => void }) {
  const [subject, setSubject] = useState(EXAM_SUBJECTS[0]);
  const counts = new Map(chapterGroups(subject).flatMap(group => group.chapters).map(chapter => [chapter, 0]));
  for (const row of rows ?? []) {
    if (row?.subject !== subject || !row.chapter || !counts.has(row.chapter)) continue;
    const count = Number(row.count);
    if (Number.isSafeInteger(count) && count > 0) counts.set(row.chapter, counts.get(row.chapter)! + count);
  }
  const top = [...counts].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return <section className="study-card study-chapters" aria-labelledby="chapters-title">
    <div className="study-section-heading"><h2 id="chapters-title"><StudyIcon name="chart" />各章節歷屆題量</h2><select aria-label="選擇章節統計科目" value={subject} onChange={event => setSubject(event.target.value)}>{EXAM_SUBJECTS.map(name => <option key={name}>{name}</option>)}</select></div>
    <p className="study-muted">依目前已分類的歷屆公開題統計，幫助你安排讀書順序。</p>
    <div className="study-chapter-results" aria-live="polite" aria-busy={!rows && !error}>
      {error ? <div className="study-empty"><p>章節題量暫時無法載入</p><button type="button" className="study-text-link" onClick={retry}>重新載入<StudyIcon name="arrow" /></button></div>
        : !rows ? <LoadingState label="正在整理章節題量…" />
        : top.length ? <ol>{top.map(([chapter, count], index) => <li key={chapter}><span className="study-chapter-rank">{index + 1}</span><span className="study-chapter-name">{chapter}</span><span className="study-chapter-bar" aria-hidden="true"><span style={{ width: `${count / top[0][1] * 100}%` }} /></span><strong>{count.toLocaleString()} 題</strong></li>)}</ol>
        : <p className="study-empty">章節題量整理中</p>}
    </div>
    <div className="study-chapter-footer"><p className="study-muted">依目前已完成章節分類的歷屆公開題目統計。</p><Link href="/subjects" className="study-text-link">查看全部章節<StudyIcon name="arrow" /></Link></div>
  </section>;
}