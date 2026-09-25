'use client';
import { useEffect } from 'react';
import { authClient } from '@/lib/auth-client';
import { setLearningOwner, retryLearning } from '@/lib/learning-client';
export default function LearningSync() {
  const { data, isPending } = authClient.useSession();
  const id = data?.user.id ?? null;
  useEffect(() => { if (!isPending) void setLearningOwner(id); }, [id, isPending]);
  useEffect(() => {
    const refresh = () => { void retryLearning(); };
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, []);
  return null;
}
