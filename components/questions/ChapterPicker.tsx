'use client';

import { chapterGroups } from '@/data/exam-chapters';
import styles from './chapter-picker.module.css';

export default function ChapterPicker({ subject, value, onChange, name }: {
  subject: string; value: string; onChange: (chapter: string) => void; name?: string;
}) {
  const groups = chapterGroups(subject);
  return <div className={styles.root}>
    {name && <input type="hidden" name={name} value={value} />}
    <details className={styles.picker}>
      <summary>章節：{value || '全部章節'}</summary>
      <div className={styles.options} role="group" aria-label={`${subject || '全部科目'}章節`}>
        <button type="button" aria-pressed={!value} onClick={() => onChange('')} className={`study-button ${styles.choice} ${!value ? 'study-button-primary' : ''}`}>全部章節</button>
        {!groups.length && <p className={styles.hint}>請先選擇科目。</p>}
        {groups.map((group, index) => <div key={group.label ?? index}>
          {group.label && <p className={styles.group}>{group.label}</p>}
          {group.chapters.map(chapter => <button key={chapter} type="button" aria-pressed={value === chapter} onClick={() => onChange(chapter)} className={`study-button ${styles.choice} ${value === chapter ? 'study-button-primary' : ''}`}>{chapter}</button>)}
        </div>)}
      </div>
    </details>
  </div>;
}
