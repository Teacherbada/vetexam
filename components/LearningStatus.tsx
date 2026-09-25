'use client';
import { useSyncExternalStore } from 'react';
import { getLearningStatus, subscribeLearning, refreshLearning, flushLearning } from '@/lib/learning-client';
export default function LearningStatus() {
  const status = useSyncExternalStore(subscribeLearning, getLearningStatus, () => 'loading');
  if (status === 'ready' || status === 'guest') return null;
  return <p role="status" className="my-3 text-sm text-[#6F7873]">{status === 'loading' ? '正在讀取帳號學習紀錄…' : <>帳號同步暫時中斷，待同步紀錄保留在本機，你仍可繼續刷題。<button className="study-button" onClick={() => void flushLearning().then(() => refreshLearning())}>重試同步</button></>}</p>;
}
