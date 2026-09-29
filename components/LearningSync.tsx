'use client';
import { useEffect } from 'react';
import { authClient } from '@/lib/auth-client';
import { setLearningOwner, retryLearning, refreshLearningOnFocus } from '@/lib/learning-client';
export default function LearningSync() {
  const { data, isPending, error } = authClient.useSession();
  const id = data?.user.id ?? null;
  useEffect(() => { if (!isPending && !error) void setLearningOwner(id); }, [id, isPending, error]);
  useEffect(() => {
    const focus = () => { void refreshLearningOnFocus(); };
    const online = () => { void retryLearning(); };
    window.addEventListener('focus', focus); window.addEventListener('online', online);
    return () => { window.removeEventListener('focus', focus); window.removeEventListener('online', online); };
  }, []);
  return null;
}
