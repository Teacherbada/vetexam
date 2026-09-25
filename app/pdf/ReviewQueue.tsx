'use client';
import { useState } from 'react';
import { EmptyState } from '@/components/ui/ContentState';
import styles from './foundation-pdf.module.css';

/** Navigation only; the parent supplies the existing review predicate and score. */
export default function ReviewQueue({ items, onJump }: { items: { id: number; number: number; confidence: number }[]; onJump: (id: number) => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const index = items.findIndex(item => item.id === selected);
  function jump(next: number) { const item = items[next]; if (item) { setSelected(item.id); onJump(item.id); } }
  if (!items.length) return <EmptyState title="目前篩選下沒有待確認題目" description="仍可展開下方題目檢查內容。" />;
  return <div className={styles.queue}>
    <div className={styles.queueNavigation}><span role="status">{index < 0 ? `待確認 ${items.length} 題` : `${index + 1} / ${items.length} 待確認`}</span><button type="button" className={styles.secondary} disabled={index <= 0} onClick={() => jump(index - 1)}>上一個需要確認</button><button type="button" className={styles.secondary} disabled={index === items.length - 1} onClick={() => jump(index + 1)}>下一個需要確認</button></div>
    <div className={styles.queueItems}>{items.map((item,i) => <button type="button" key={item.id} className={styles.secondary} aria-pressed={item.id === selected} onClick={() => jump(i)}>第 {item.number} 題 · {item.confidence}</button>)}</div>
  </div>;
}
