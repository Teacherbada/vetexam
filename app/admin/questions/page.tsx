import { requireAdminPage } from '@/lib/admin-page';
import QuestionsAdmin from './QuestionsAdmin';

export default async function AdminQuestionsPage() {
  await requireAdminPage();
  return <QuestionsAdmin />;
}
