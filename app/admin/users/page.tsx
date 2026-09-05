import { requireAdminPage } from "@/lib/admin-page";
import Users from "./Users";
export default async function UsersPage() {
  await requireAdminPage();
  return <Users />;
}
