'use client';
import Link from 'next/link';
import { fetchAI } from '@/lib/ai-question-client';
import { useRef, useState } from 'react';
import { EXAM_SUBJECTS, chapterGroups } from '@/data/exam-chapters';
import { AI_NOTICE, type AISource as Source } from '@/lib/ai-question-input';
import AISource from '@/components/questions/AISource';
import styles from '../questions/quiz.module.css';
import adminStyles from '../admin/questions/questions.module.css';
type Question = { id: string; revision: number; subject: string; chapter: string; question: string; options: string[] };
type Result = { answer: string; correct: boolean; explanation: string; optionExplanations: string[]; source: Source; generationMethod: string };
export default function AIPractice() {
  const [subject,setSubject] = useState(EXAM_SUBJECTS[0]), [chapter,setChapter] = useState('');
  const [questions,setQuestions] = useState<Question[]>([]), [index,setIndex] = useState(0), [next,setNext] = useState<string | null>(null);
  const [result,setResult] = useState<Result | null>(null), [selected,setSelected] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState(''), [started,setStarted] = useState(false), [finished,setFinished] = useState(false);
  const [score,setScore] = useState({ answered: 0, correct: 0 });
  const lock = useRef(false), attempt = useRef<{ key: string; answer: string } | null>(null);
  const q = questions[index];
  async function load(after = '') {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetchAI('/api/ai-questions?' + new URLSearchParams({ subject, chapter, after }), { cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '載入失敗');
      setQuestions(data.questions); setIndex(0); setNext(data.next); setResult(null); setSelected(''); attempt.current = null; setStarted(true); setFinished(false);
      if (!after) setScore({ answered: 0, correct: 0 });
    } catch(e) { setError(e instanceof Error ? e.message : '載入失敗'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function choose(answer: string) {
    if (lock.current || result || !q) return;
    lock.current = true; setBusy(true); setSelected(answer); setError('');
    if (!attempt.current || attempt.current.answer !== answer) attempt.current = { key: crypto.randomUUID(), answer };
    try {
      const response = await fetchAI('/api/ai-questions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: q.id, revision: q.revision, answer, requestKey: attempt.current.key }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '作答失敗');
      setResult(data); setScore(s => ({ answered: s.answered + 1, correct: s.correct + (data.correct ? 1 : 0) }));
      // AI practice deliberately does not call any exam/localStorage progress writer.
    } catch(e) { setError(e instanceof Error ? e.message : '作答失敗，請重試'); }
    finally { lock.current = false; setBusy(false); }
  }
  function advance() { setIndex(i => i + 1); setResult(null); setSelected(''); setError(''); attempt.current = null; }
  return <main className={styles.page}><div className={styles.container}>
    <nav className={styles.actions}><Link href="/subjects" className="study-button">歷屆國考題</Link><Link href="/" className="study-button">首頁</Link></nav>
    <header className="my-6"><h1 className="text-2xl font-semibold">獸醫練功房</h1><p>{AI_NOTICE}</p><p className="mt-2 text-sm">題目依管理員提供的教材內容，由 AI 輔助生成。練功紀錄獨立保存，不計入國考模擬成績、排行榜、弱點分析或教練選題。</p></header>
    <section className={styles.card}><h2 className="mb-4 font-semibold">選擇科目與章節</h2>
      <fieldset disabled={busy || started}>
        <label className={adminStyles.field}>科目<select aria-label="科目" value={subject} onChange={e => { setSubject(e.target.value); setChapter(''); }}>{EXAM_SUBJECTS.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className={adminStyles.field}>章節<select aria-label="章節" value={chapter} onChange={e => setChapter(e.target.value)}><option value="">全部章節</option>{chapterGroups(subject).flatMap(g => g.chapters).map(c => <option key={c}>{c}</option>)}</select></label>
      </fieldset>
      <div className={styles.actions}>{!started ? <button className="study-button" disabled={busy} onClick={() => void load()}>開始練功</button> :
        <button className="study-button" disabled={busy} onClick={() => { setStarted(false); setFinished(false); setQuestions([]); setResult(null); setError(''); setScore({answered:0,correct:0}); }}>重新選擇科目</button>}
        <p>本輪練功：已答 {score.answered} 題／答對 {score.correct} 題</p></div>
    </section>
    {busy && <p role="status">處理中…</p>}{error && <p className="my-4" role="alert">{error}</p>}
    {started && !q && <p className={styles.state}>獸醫練功房此分類目前沒有已審核發布的題目。</p>}
    {finished && <section className={styles.card + ' mt-6'} aria-label="獸醫練功房測驗結果"><h2 className="font-semibold">測驗結果</h2><p>教材衍生題｜非歷屆國考題</p><p>已提交 {score.answered} 題，答對 {score.correct} 題，正確率 {score.answered ? Math.round(score.correct / score.answered * 100) : 0}%。</p><p>此結果僅供獸醫練功房練習，不計入國考成績、弱點分析或排行榜。</p></section>}
    {q && <article className={styles.card + ' mt-6'} key={q.id}>
      <p className={styles.meta}>教材衍生題｜非歷屆國考題</p><p>{q.subject}／{q.chapter}</p>
      <p className={styles.progressLabel}>本頁第 {index + 1}／{questions.length} 題</p>
      <h2 className={styles.question}>{q.question}</h2>
      <div className={styles.options} role="group" aria-label="答案選項">{q.options.map((o,i) => {
        const letter = 'ABCD'[i], correct = result?.answer === letter, wrong = !!result && selected === letter && !correct;
        return <button key={letter} disabled={busy || !!result} aria-pressed={selected === letter} onClick={() => {setSelected(letter);setError('');}}
          className={styles.option + ' ' + (correct ? styles.correct : wrong ? styles.wrong : selected === letter ? styles.selected : '')}>
          <span className={styles.letter}>{letter}</span><span className={styles.optionText}>{o}</span>
          {correct && <span className={styles.answerStatus}>正確答案</span>}{selected === letter && <span className={styles.answerStatus}>你的答案</span>}
        </button>;
      })}</div>
      {!result && <div className={styles.actions}><button className="study-button" disabled={busy || !selected} onClick={()=>void choose(selected)}>提交答案</button></div>}
      {result && <section className={styles.explanation}><p role="status" className={result.correct ? styles.correctText : styles.wrongText}>{result.correct ? '答對' : '答錯'}｜你的答案：{selected}｜正確答案：{result.answer}</p>
        <h2>解析（人工審核發布）</h2><p className={styles.explanationText}>{result.explanation}</p>
        {result.optionExplanations.map((e,i) => e && <p key={i} className={styles.explanationText}>{'ABCD'[i]} 解析：{e}</p>)}
        <AISource source={result.source} /><p className="mt-4 text-sm">{result.generationMethod}；本版本已人工審核。</p>
      </section>}
      <div className={styles.actions}>{index < questions.length - 1 ? <button className="study-button" disabled={busy} onClick={advance}>{result ? '下一題' : '略過此題'}</button> : next ?
        <button className="study-button" disabled={busy} onClick={() => void load(next)}>載入下一頁題目</button> : <button className="study-button" disabled={busy || !result || finished} onClick={()=>setFinished(true)}>查看測驗結果</button>}</div>
    </article>}
  </div></main>;
}
