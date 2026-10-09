import { requireAdminPage } from '@/lib/admin-page';
import Link from 'next/link';
import QuestionsAdmin from './QuestionsAdmin';

export default async function AdminQuestionsPage() {
  await requireAdminPage();
  return <><nav className="px-6 pt-4"><Link href="/admin/ai-questions" className="study-button">AI 試題匯入／審核</Link></nav><QuestionsAdmin /></>;
}
