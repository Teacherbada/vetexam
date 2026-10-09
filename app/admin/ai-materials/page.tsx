import { requireAdminPage } from '@/lib/admin-page';
import AIMaterialsAdmin from './AIMaterialsAdmin';
export default async function AIMaterialsPage() {
  await requireAdminPage();
  return <AIMaterialsAdmin />;
}
