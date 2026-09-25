'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { PublicQuestion } from '@/lib/public-questions';
import { formatExamYear } from '@/lib/exam-year';
import OptionDistribution from '@/components/questions/OptionDistribution';
import { saveProgress } from '@/data/progress';
import { saveWrongQuestion } from '@/data/wrongAnswers';
import { addDailyProgress } from '@/data/tasksProgress';
import { recordLearning } from '@/lib/learning-client';
import styles from '../quiz.module.css';
import searchStyles from '../search/search.module.css';

type Result = { available: boolean; answer?: string; correct?: boolean; explanation?: string };
export default function QuestionDetail({ question, shareUrl }: { question: PublicQuestion; shareUrl: string | null }) {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  async function choose(letter: string) {
    if (locked.current || !question.hasAnswer) return;
    locked.current = true; setPending(true); setSelected(letter); setError('');
    try {
      const response = await fetch('/api/stats/answers?reveal=1', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: [{ question_id: question.id, selected_answer: letter }] }), signal: AbortSignal.timeout(20000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '作答暫時無法送出，請重試。');
      setResult(data);
      if (data.available) {
        recordLearning([{ question_id: question.id, selected_answer: letter }]);
        // Preserve existing browser progress; its failure cannot hide the server result.
        try {
          addDailyProgress(); saveProgress(question.id, data.correct, question.subject);
          if (!data.correct) saveWrongQuestion({ ...question, answer: data.answer, explanation: data.explanation, questionSetName: '' }, letter);
        } catch { /* Browser storage may be unavailable in private browsing. */ }
      }
    } catch (failure) {
      locked.current = false; setSelected('');
      setError(failure instanceof Error && failure.name !== 'TimeoutError' ? failure.message : '作答暫時無法送出，請重試。');
    } finally { setPending(false); }
  }
  async function copyLink() {
    if (!shareUrl) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([navigator.clipboard.writeText(shareUrl), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Clipboard unavailable')), 3000);
      })]);
      setShareMessage('已複製題目連結');
    }
    catch { setShareMessage('無法自動複製，請選取下方連結複製。'); }
    finally { if (timer) clearTimeout(timer); }
  }
  const missing = !question.hasAnswer || result?.available === false;
  return <main className={styles.page}><div className={styles.container}>
    <nav className={searchStyles.actions} aria-label="導覽"><Link href="/questions/search" className="study-button">題目搜尋</Link><Link href="/subjects" className="study-button">開始刷題</Link></nav>
    <article className={styles.card}>
      <p className={styles.meta}>{formatExamYear(question.examYear)}｜{question.subject}｜第 {question.questionNumber} 題</p>
      <h1 className={styles.question}>{question.question}</h1>
      {missing && <p role="status">本題正確答案目前正在整理中。<Link href="/feedback" className="study-button">回報題目</Link></p>}
      <div className={styles.options} role="group" aria-label="答案選項">{question.options.map((option, index) => {
        if (!option.trim()) return null;
        const letter = String.fromCharCode(65 + index);
        const correct = result?.available && result.answer === letter;
        const wrong = result?.available && selected === letter && !correct;
        return <button key={letter} disabled={pending || Boolean(result) || missing} aria-pressed={selected === letter} onClick={() => choose(letter)} className={`${styles.option} ${correct ? styles.correct : wrong ? styles.wrong : selected === letter ? styles.selected : ''}`}><span className={styles.letter}>{letter}</span><span className={styles.optionText}>{option}</span>{correct && <span className={styles.answerStatus}>正確答案</span>}{selected === letter && <span className={styles.answerStatus}>你的答案</span>}</button>;
      })}</div>
      {pending && <p role="status">正在送出作答…</p>}{error && <p role="alert">{error}</p>}
      {result?.available && <>
        <section className={styles.explanation} aria-label="作答結果"><h2>作答結果</h2><p role="status" className={result.correct ? styles.correctText : styles.wrongText}>{result.correct ? '答對' : '答錯'} · 你的答案：{selected} · 正確答案：{result.answer}</p>
          <h2>VetExam 官方解析</h2><p className={styles.explanationText}>{result.explanation?.trim() || '目前尚未建立官方解析。'}</p>
        </section>
        <OptionDistribution questionId={question.id} selectedAnswer={selected} correctAnswer={result.answer!} expanded />
      </>}
      <div className={searchStyles.actions}>{shareUrl && <button onClick={copyLink} className="study-button">複製題目連結</button>}<Link href="/feedback" className="study-button">回報題目</Link></div>
      {shareMessage && <div role="status"><p>{shareMessage}</p>{shareMessage.startsWith('無法') && <p className={styles.explanationText}>{shareUrl}</p>}</div>}
    </article>
  </div></main>;
}
