import { requireAdminPage } from "@/lib/admin-page";
import Reports from "./Reports";
export default async function ReportsPage() {
  await requireAdminPage();
  return <Reports />;
}
