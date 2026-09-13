'use client';

import { useState } from 'react';
import { EXAM_SUBJECTS } from '@/data/exam-chapters';
import ChapterPicker from '@/components/questions/ChapterPicker';
import styles from './search.module.css';

export default function SubjectChapterFields({ subject, chapter }: { subject: string; chapter: string }) {
  const [selectedSubject, setSubject] = useState(subject);
  const [selectedChapter, setChapter] = useState(chapter);
  return <>
    <label>科目<select aria-label="科目" name="subject" value={selectedSubject} onChange={event => { setSubject(event.target.value); setChapter(''); }}><option value="">全部科目</option>{EXAM_SUBJECTS.map(item => <option key={item}>{item}</option>)}</select></label>
    <div className={styles.chapter}><ChapterPicker subject={selectedSubject} value={selectedChapter} onChange={setChapter} name="chapter" /></div>
  </>;
}
