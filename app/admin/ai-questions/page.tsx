import { requireAdminPage } from '@/lib/admin-page';
import AIQuestionsAdmin from './AIQuestionsAdmin';
export default async function AIQuestionsAdminPage() {
  await requireAdminPage();
  return <AIQuestionsAdmin />;
}
