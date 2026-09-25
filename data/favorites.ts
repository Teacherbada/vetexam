import { learningOwner, reviewItems, updateReview, optimisticFavorites } from '../lib/learning-client';
export function getFavorites() { return reviewItems('favorites'); }
export function toggleFavorite(question: { id: number; subject: string; question: string; options: string[]; answer: string; explanation: string }) {
  const favorites = getFavorites();
  const exists = favorites.some(item => item.id === question.id);
  const updated = exists ? favorites.filter(item => item.id !== question.id) : [...favorites, question];
  if (learningOwner()) { optimisticFavorites(updated); updateReview(question.id, 'favorite', !exists); }
  else { try { localStorage.setItem('favorites', JSON.stringify(updated)); } catch { /* Browsing remains available. */ } }
  return updated;
}
